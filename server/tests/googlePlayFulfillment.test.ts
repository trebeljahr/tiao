process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import {
  PlayFulfillment,
  PlayFulfillmentError,
  playAccountIdFor,
  playSubscriptionId,
} from "../payments/googlePlayFulfillment";
import { authenticatePush, GoogleCertCache } from "../payments/pubsubAuth";
import { FakeGooglePlay, MemoryPlayStore, PACKAGE, signOidcToken } from "./googlePlayTestKit";

const ALICE = "64b000000000000000000001";
const BOB = "64b000000000000000000002";

let google: FakeGooglePlay;
let store: MemoryPlayStore;
let play: PlayFulfillment;

beforeEach(() => {
  google = new FakeGooglePlay();
  store = new MemoryPlayStore(() => google.now);
  play = new PlayFulfillment(google.api(), store, () => google.now);
  store.playAccountIds.set(playAccountIdFor(ALICE), ALICE);
  store.playAccountIds.set(playAccountIdFor(BOB), BOB);
});

async function rejects(promise: Promise<unknown>, code: string, status: number) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof PlayFulfillmentError, String(err));
    assert.equal(err.code, code);
    assert.equal(err.status, status);
    return true;
  });
}

describe("Google Play one-time products", () => {
  test("grants the item, acknowledges, and records the token", async () => {
    google.addProduct("tok-1", "badge_coral", {
      obfuscatedExternalAccountId: playAccountIdFor(ALICE),
    });

    const outcome = await play.verify({
      productId: "badge_coral",
      purchaseToken: "tok-1",
      claimantId: ALICE,
    });

    assert.deepEqual(outcome, {
      status: "granted",
      itemType: "badge",
      itemId: "badge-1",
      kind: "one_time",
      acknowledged: true,
    });
    assert.ok(store.account(ALICE).badges.has("badge-1"));
    assert.deepEqual(google.acks, ["tok-1"]);
    const record = store.purchases.get("tok-1");
    assert.equal(record?.playerId, ALICE);
    assert.equal(record?.acknowledged, true);
  });

  test("grants themes into unlockedThemes", async () => {
    google.addProduct("tok-theme", "theme_sakura");
    await play.verify({ productId: "theme_sakura", purchaseToken: "tok-theme", claimantId: ALICE });
    assert.ok(store.account(ALICE).themes.has("sakura"));
  });

  test("is idempotent: verify, restore and RTDN for one token grant and ack once", async () => {
    google.addProduct("tok-1", "badge_coral", {
      obfuscatedExternalAccountId: playAccountIdFor(ALICE),
    });

    await play.verify({ productId: "badge_coral", purchaseToken: "tok-1", claimantId: ALICE });
    await play.verify({ productId: "badge_coral", purchaseToken: "tok-1", claimantId: ALICE });
    const rtdn = await play.handleNotification({
      packageName: PACKAGE,
      oneTimeProductNotification: {
        notificationType: 1,
        purchaseToken: "tok-1",
        sku: "badge_coral",
      },
    });

    assert.deepEqual(rtdn, { retry: false });
    assert.deepEqual(google.acks, ["tok-1"]);
    assert.equal(store.purchases.size, 1);
    assert.deepEqual([...store.account(ALICE).badges], ["badge-1"]);
    // One OAuth exchange serves every call while the token is fresh.
    assert.equal(google.tokenExchanges, 1);
  });

  test("rejects a token bought from another account", async () => {
    google.addProduct("tok-1", "badge_coral", {
      obfuscatedExternalAccountId: playAccountIdFor(ALICE),
    });
    await rejects(
      play.verify({ productId: "badge_coral", purchaseToken: "tok-1", claimantId: BOB }),
      "PURCHASE_ACCOUNT_MISMATCH",
      403,
    );
    assert.equal(store.account(BOB).badges.size, 0);
  });

  test("a token without an account id belongs to whoever reports it first", async () => {
    google.addProduct("promo", "badge_slate");
    await play.verify({ productId: "badge_slate", purchaseToken: "promo", claimantId: ALICE });
    await rejects(
      play.verify({ productId: "badge_slate", purchaseToken: "promo", claimantId: BOB }),
      "PURCHASE_ALREADY_CLAIMED",
      409,
    );
    assert.ok(store.account(ALICE).badges.has("badge-5"));
    assert.equal(store.account(BOB).badges.size, 0);
  });

  test("pending purchases grant nothing until the RTDN reports them purchased", async () => {
    google.addProduct("tok-p", "badge_indigo", {
      purchaseState: 2,
      obfuscatedExternalAccountId: playAccountIdFor(ALICE),
    });
    assert.deepEqual(
      await play.verify({ productId: "badge_indigo", purchaseToken: "tok-p", claimantId: ALICE }),
      { status: "pending" },
    );
    assert.equal(store.account(ALICE).badges.size, 0);
    assert.deepEqual(google.acks, []);

    // Cash payment clears while the app is closed.
    const purchase = google.products.get("tok-p");
    if (purchase) purchase.purchaseState = 0;
    await play.handleNotification({
      oneTimeProductNotification: {
        notificationType: 1,
        purchaseToken: "tok-p",
        sku: "badge_indigo",
      },
    });
    assert.ok(store.account(ALICE).badges.has("badge-2"));
    assert.deepEqual(google.acks, ["tok-p"]);
  });

  test("RTDN finds the account from the obfuscated id when the app never reported the token", async () => {
    google.addProduct("tok-orphan", "theme_ocean", {
      obfuscatedExternalAccountId: playAccountIdFor(BOB),
    });
    await play.handleNotification({
      oneTimeProductNotification: {
        notificationType: 1,
        purchaseToken: "tok-orphan",
        sku: "theme_ocean",
      },
    });
    assert.ok(store.account(BOB).themes.has("ocean"));
  });

  test("RTDN for an unknown account leaves the purchase for the app to claim", async () => {
    google.addProduct("tok-x", "theme_ocean", { obfuscatedExternalAccountId: "f".repeat(64) });
    const result = await play.handleNotification({
      oneTimeProductNotification: {
        notificationType: 1,
        purchaseToken: "tok-x",
        sku: "theme_ocean",
      },
    });
    assert.deepEqual(result, { retry: false });
    assert.equal(store.purchases.size, 0);
  });

  test("canceled purchases are not granted", async () => {
    google.addProduct("tok-c", "badge_coral", { purchaseState: 1 });
    assert.deepEqual(
      await play.verify({ productId: "badge_coral", purchaseToken: "tok-c", claimantId: ALICE }),
      { status: "not_entitled", state: "canceled" },
    );
    assert.equal(store.account(ALICE).badges.size, 0);
  });

  test("a voided purchase is revoked and stays revoked", async () => {
    google.addProduct("tok-v", "badge_prism_rainbow");
    await play.verify({
      productId: "badge_prism_rainbow",
      purchaseToken: "tok-v",
      claimantId: ALICE,
    });
    assert.ok(store.account(ALICE).badges.has("badge-7"));

    await play.handleNotification({
      voidedPurchaseNotification: { purchaseToken: "tok-v", orderId: "GPA.tok-v", productType: 2 },
    });
    assert.equal(store.account(ALICE).badges.has("badge-7"), false);

    const again = await play.verify({
      productId: "badge_prism_rainbow",
      purchaseToken: "tok-v",
      claimantId: ALICE,
    });
    assert.deepEqual(again, { status: "not_entitled", state: "voided" });
    assert.equal(store.account(ALICE).badges.has("badge-7"), false);
  });

  test("a failed acknowledge still grants and asks Pub/Sub to redeliver", async () => {
    google.addProduct("tok-a", "badge_coral", {
      obfuscatedExternalAccountId: playAccountIdFor(ALICE),
    });
    google.failAcks = true;
    const result = await play.handleNotification({
      oneTimeProductNotification: {
        notificationType: 1,
        purchaseToken: "tok-a",
        sku: "badge_coral",
      },
    });
    assert.deepEqual(result, { retry: true });
    assert.ok(store.account(ALICE).badges.has("badge-1"));

    google.failAcks = false;
    const outcome = await play.verify({
      productId: "badge_coral",
      purchaseToken: "tok-a",
      claimantId: ALICE,
    });
    assert.equal(outcome.status === "granted" && outcome.acknowledged, true);
    assert.deepEqual(google.acks, ["tok-a"]);
  });

  test("unknown product ids and unknown tokens are rejected", async () => {
    await rejects(
      play.verify({ productId: "badge_nope", purchaseToken: "t", claimantId: ALICE }),
      "ITEM_NOT_FOUND",
      404,
    );
    await assert.rejects(
      play.verify({ productId: "badge_coral", purchaseToken: "missing", claimantId: ALICE }),
      (err: { status?: number; isPermanent?: boolean }) =>
        err.status === 404 && err.isPermanent === true,
    );
  });

  test("RTDN retries transient Google errors and drops permanent ones", async () => {
    const notification = {
      oneTimeProductNotification: {
        notificationType: 1,
        purchaseToken: "missing",
        sku: "badge_coral",
      },
    };
    assert.deepEqual(await play.handleNotification(notification), { retry: false });
    google.failWith = 503;
    assert.deepEqual(await play.handleNotification(notification), { retry: true });
  });

  test("RTDN ignores test pings and other packages", async () => {
    assert.deepEqual(await play.handleNotification({ testNotification: { version: "1.0" } }), {
      retry: false,
    });
    google.addProduct("tok-1", "badge_coral", {
      obfuscatedExternalAccountId: playAccountIdFor(ALICE),
    });
    await play.handleNotification({
      packageName: "com.example.other",
      oneTimeProductNotification: {
        notificationType: 1,
        purchaseToken: "tok-1",
        sku: "badge_coral",
      },
    });
    assert.equal(store.purchases.size, 0);
  });
});

describe("Google Play subscriptions", () => {
  const SUB = playSubscriptionId("sub-1");

  function patronRow(playerId: string) {
    return store.account(playerId).subs.find((s) => s.subscriptionId === SUB);
  }

  async function subscribe() {
    google.addSubscription("sub-1", "SUBSCRIPTION_STATE_ACTIVE", {
      externalAccountIdentifiers: { obfuscatedExternalAccountId: playAccountIdFor(ALICE) },
    });
    return play.verify({ productId: "sub_patron", purchaseToken: "sub-1", claimantId: ALICE });
  }

  function rtdn(type: number, token = "sub-1") {
    return play.handleNotification({
      subscriptionNotification: {
        notificationType: type,
        purchaseToken: token,
        subscriptionId: "sub_patron",
      },
    });
  }

  test("an active subscription grants the badge and a subscription row like Stripe", async () => {
    const outcome = await subscribe();
    assert.equal(outcome.status, "granted");
    assert.ok(store.account(ALICE).badges.has("patron"));
    const row = patronRow(ALICE);
    assert.equal(row?.status, "active");
    assert.equal(row?.provider, "google_play");
    assert.equal(row?.badgeId, "patron");
    assert.equal(row?.currentPeriodEnd.getTime(), google.now + 30 * 86_400_000);
    assert.deepEqual(google.acks, ["sub-1"]);
  });

  test("renewal moves the period end forward without a second ack", async () => {
    await subscribe();
    google.addSubscription("sub-1", "SUBSCRIPTION_STATE_ACTIVE", {
      expiresInDays: 60,
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      externalAccountIdentifiers: { obfuscatedExternalAccountId: playAccountIdFor(ALICE) },
    });
    await rtdn(2); // SUBSCRIPTION_RENEWED
    assert.equal(patronRow(ALICE)?.currentPeriodEnd.getTime(), google.now + 60 * 86_400_000);
    assert.deepEqual(google.acks, ["sub-1"]);
  });

  test("a canceled subscription keeps the badge until it expires, then revokes it", async () => {
    await subscribe();
    google.addSubscription("sub-1", "SUBSCRIPTION_STATE_CANCELED", {
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    });
    await rtdn(3); // SUBSCRIPTION_CANCELED
    assert.equal(patronRow(ALICE)?.status, "canceled");
    assert.ok(store.account(ALICE).badges.has("patron"));

    google.addSubscription("sub-1", "SUBSCRIPTION_STATE_EXPIRED", { expiresInDays: -1 });
    await rtdn(13); // SUBSCRIPTION_EXPIRED
    assert.equal(patronRow(ALICE), undefined);
    assert.equal(store.account(ALICE).badges.has("patron"), false);
  });

  test("grace period keeps access as past_due; account hold removes it until recovery", async () => {
    await subscribe();
    google.addSubscription("sub-1", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", {
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    });
    await rtdn(6);
    assert.equal(patronRow(ALICE)?.status, "past_due");
    assert.ok(store.account(ALICE).badges.has("patron"));

    google.addSubscription("sub-1", "SUBSCRIPTION_STATE_ON_HOLD", {
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    });
    await rtdn(5);
    assert.equal(patronRow(ALICE)?.status, "past_due");
    assert.equal(store.account(ALICE).badges.has("patron"), false);

    google.addSubscription("sub-1", "SUBSCRIPTION_STATE_ACTIVE", {
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    });
    await rtdn(1); // SUBSCRIPTION_RECOVERED
    assert.equal(patronRow(ALICE)?.status, "active");
    assert.ok(store.account(ALICE).badges.has("patron"));
  });

  test("expiry does not revoke a badge another active subscription still pays for", async () => {
    await subscribe();
    store.account(ALICE).subs.push({
      subscriptionId: "sub_stripe_1",
      badgeId: "patron",
      status: "active",
      currentPeriodEnd: new Date(google.now + 86_400_000),
      provider: "stripe",
    });
    google.addSubscription("sub-1", "SUBSCRIPTION_STATE_EXPIRED", { expiresInDays: -1 });
    await rtdn(13);
    assert.ok(store.account(ALICE).badges.has("patron"));
  });

  test("a resubscribe token replaces the old row without dropping the badge", async () => {
    await subscribe();
    google.addSubscription("sub-2", "SUBSCRIPTION_STATE_ACTIVE", {
      linkedPurchaseToken: "sub-1",
      externalAccountIdentifiers: { obfuscatedExternalAccountId: playAccountIdFor(ALICE) },
    });
    await play.verify({ productId: "sub_patron", purchaseToken: "sub-2", claimantId: ALICE });

    const subs = store.account(ALICE).subs.map((s) => s.subscriptionId);
    assert.deepEqual(subs, [playSubscriptionId("sub-2")]);
    assert.equal(store.purchases.get("sub-1")?.supersededBy, "sub-2");
    assert.ok(store.account(ALICE).badges.has("patron"));

    // A late EXPIRED for the replaced token must not take the badge away.
    google.addSubscription("sub-1", "SUBSCRIPTION_STATE_EXPIRED", { expiresInDays: -1 });
    await rtdn(13, "sub-1");
    assert.ok(store.account(ALICE).badges.has("patron"));
    assert.deepEqual(
      store.account(ALICE).subs.map((s) => s.subscriptionId),
      [playSubscriptionId("sub-2")],
    );
  });

  test("a revoked subscription (refund) re-syncs and removes access", async () => {
    await subscribe();
    google.addSubscription("sub-1", "SUBSCRIPTION_STATE_EXPIRED", { expiresInDays: 0 });
    await play.handleNotification({
      voidedPurchaseNotification: { purchaseToken: "sub-1", productType: 1 },
    });
    assert.equal(patronRow(ALICE), undefined);
    assert.equal(store.account(ALICE).badges.has("patron"), false);
  });

  test("a token for another subscription product is rejected", async () => {
    google.addSubscription("sub-1", "SUBSCRIPTION_STATE_ACTIVE", {
      lineItems: [{ productId: "sub_other", expiryTime: new Date(google.now + 1e9).toISOString() }],
    });
    await rejects(
      play.verify({ productId: "sub_patron", purchaseToken: "sub-1", claimantId: ALICE }),
      "PRODUCT_MISMATCH",
      400,
    );
  });

  test("a pending subscription grants nothing", async () => {
    google.addSubscription("sub-1", "SUBSCRIPTION_STATE_PENDING");
    assert.deepEqual(
      await play.verify({ productId: "sub_patron", purchaseToken: "sub-1", claimantId: ALICE }),
      { status: "pending" },
    );
    assert.equal(store.account(ALICE).badges.size, 0);
  });
});

describe("Pub/Sub push authentication", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const now = Date.parse("2026-10-05T00:00:00Z");
  const nowSeconds = now / 1000;
  const audience = "https://api.playtiao.com/api/shop/iap/google-play/rtdn";
  const email = "rtdn-push@tiao.iam.gserviceaccount.com";
  let certFetches = 0;

  function certs() {
    certFetches = 0;
    return new GoogleCertCache(
      async () => {
        certFetches++;
        const jwk = publicKey.export({ format: "jwk" });
        return new Response(JSON.stringify({ keys: [{ ...jwk, kid: "k1", alg: "RS256" }] }), {
          headers: { "cache-control": "public, max-age=3600" },
        });
      },
      () => now,
    );
  }

  function token(claims: Record<string, unknown> = {}, kid = "k1", key = privateKey) {
    return signOidcToken(key, kid, {
      iss: "https://accounts.google.com",
      aud: audience,
      email,
      email_verified: true,
      iat: nowSeconds - 10,
      exp: nowSeconds + 3600,
      ...claims,
    });
  }

  const config = { audience, serviceAccountEmail: email };

  test("accepts a Google-signed token for our audience and push account", async () => {
    const cache = certs();
    const result = await authenticatePush(
      { authorization: `Bearer ${token()}` },
      config,
      cache,
      () => now,
    );
    assert.deepEqual(result, { ok: true });
    await authenticatePush({ authorization: `Bearer ${token()}` }, config, cache, () => now);
    assert.equal(certFetches, 1, "certs are cached");
  });

  test("rejects wrong audience, wrong account, expiry, bad signature and missing header", async () => {
    const cache = certs();
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const cases: Array<[string | undefined, string]> = [
      [`Bearer ${token({ aud: "https://evil.example" })}`, "wrong audience"],
      [`Bearer ${token({ email: "someone@else.com" })}`, "wrong service account"],
      [`Bearer ${token({ exp: nowSeconds - 3600 })}`, "token expired"],
      [`Bearer ${token({ iss: "https://evil.example" })}`, "wrong issuer"],
      [`Bearer ${token({}, "k1", other)}`, "bad signature"],
      [`Bearer ${token({}, "k-unknown")}`, "unknown signing key"],
      ["Bearer not.a.jwt", "malformed token"],
      [undefined, "missing bearer token"],
    ];
    for (const [authorization, reason] of cases) {
      const result = await authenticatePush({ authorization }, config, cache, () => now);
      assert.deepEqual(result, { ok: false, status: 401, reason }, reason);
    }
  });

  test("falls back to a shared query token, and refuses when nothing is configured", async () => {
    const cache = certs();
    assert.deepEqual(
      await authenticatePush({ queryToken: "s3cret" }, { sharedToken: "s3cret" }, cache),
      { ok: true },
    );
    assert.equal(
      (await authenticatePush({ queryToken: "nope" }, { sharedToken: "s3cret" }, cache)).ok,
      false,
    );
    assert.deepEqual(await authenticatePush({}, {}, cache), {
      ok: false,
      status: 503,
      reason: "RTDN endpoint auth is not configured",
    });
  });
});
