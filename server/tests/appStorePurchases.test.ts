process.env.TOKEN_SECRET = "test-secret";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME = "tiao-test-assets";
process.env.S3_PUBLIC_URL = "https://assets.test.local";
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { createPrivateKey, randomUUID, sign, X509Certificate } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { Environment } from "@apple/app-store-server-library";
import {
  appStoreAccountTokenFor,
  claimAppStorePurchase,
  processAppStoreNotification,
} from "../appStore/appStoreEntitlements";
import {
  type AppStoreGateway,
  type AppStoreGatewayOptions,
  createAppStoreGateway,
  setAppStoreGatewayForTests,
} from "../appStore/appStoreGateway";
import {
  APP_STORE_BUNDLE_ID,
  appStoreProductId,
  appStoreProductType,
  findShopItemByAppStoreProductId,
  SHOP_ITEMS,
} from "../config/shopCatalog";
import Achievement from "../models/Achievement";
import AppStoreNotification from "../models/AppStoreNotification";
import AppStorePurchase from "../models/AppStorePurchase";
import GameAccount from "../models/GameAccount";
import { handleAppStoreNotification } from "../routes/appStore.routes";
import {
  TEST_INTERMEDIATE_CERT_PEM,
  TEST_LEAF_CERT_PEM,
  TEST_LEAF_PRIVATE_KEY_PEM,
  TEST_ROOT_CERT_PEM,
} from "./appStoreTestPki";

// ---------------------------------------------------------------------------
// Mock JWS signed by the test PKI, verified by Apple's real SignedDataVerifier
// ---------------------------------------------------------------------------

const APP_APPLE_ID = 6_700_000_001;
const derBase64 = (pem: string) => new X509Certificate(pem).raw.toString("base64");
const X5C = [TEST_LEAF_CERT_PEM, TEST_INTERMEDIATE_CERT_PEM, TEST_ROOT_CERT_PEM].map(derBase64);
const LEAF_KEY = createPrivateKey(TEST_LEAF_PRIVATE_KEY_PEM);

function signJws(payload: object, x5c: string[] = X5C, key = LEAF_KEY): string {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", x5c })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign("sha256", Buffer.from(`${header}.${body}`), {
    key,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${header}.${body}.${signature}`;
}

const DAY = 24 * 60 * 60 * 1000;
let txCounter = 1000;

type TxOverrides = Record<string, unknown> & { productId: string };

function transaction(overrides: TxOverrides) {
  const id = String(txCounter++);
  const now = Date.now();
  return {
    transactionId: id,
    originalTransactionId: id,
    bundleId: APP_STORE_BUNDLE_ID,
    purchaseDate: now - 1000,
    originalPurchaseDate: now - 1000,
    quantity: 1,
    type: "Non-Consumable",
    inAppOwnershipType: "PURCHASED",
    signedDate: now,
    environment: "Sandbox",
    transactionReason: "PURCHASE",
    storefront: "USA",
    storefrontId: "143441",
    price: 2990,
    currency: "USD",
    ...overrides,
  };
}

function subscriptionTx(overrides: Partial<TxOverrides> = {}) {
  return transaction({
    productId: "com.ricoslabs.tiao.sub.patron.monthly",
    type: "Auto-Renewable Subscription",
    subscriptionGroupIdentifier: "21500000",
    expiresDate: Date.now() + 30 * DAY,
    ...overrides,
  });
}

function renewalInfo(tx: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    originalTransactionId: tx.originalTransactionId,
    autoRenewProductId: tx.productId,
    productId: tx.productId,
    autoRenewStatus: 1,
    signedDate: Date.now(),
    environment: tx.environment,
    recentSubscriptionStartDate: tx.purchaseDate,
    renewalDate: tx.expiresDate,
    ...overrides,
  };
}

function notification(
  notificationType: string,
  tx: Record<string, unknown>,
  options: { subtype?: string; renewal?: Record<string, unknown>; uuid?: string } = {},
) {
  return signJws({
    notificationType,
    subtype: options.subtype,
    notificationUUID: options.uuid ?? randomUUID(),
    version: "2.0",
    signedDate: Date.now(),
    data: {
      appAppleId: tx.environment === "Production" ? APP_APPLE_ID : undefined,
      bundleId: APP_STORE_BUNDLE_ID,
      bundleVersion: "1",
      environment: tx.environment,
      signedTransactionInfo: signJws(tx),
      signedRenewalInfo: options.renewal ? signJws(options.renewal) : undefined,
      status: 1,
    },
  });
}

const apiCalls: { method: string; args: unknown[] }[] = [];
const apiTransactions = new Map<string, string>();

function buildGateway(overrides: Partial<AppStoreGatewayOptions> = {}): AppStoreGateway {
  return createAppStoreGateway({
    bundleId: APP_STORE_BUNDLE_ID,
    appAppleId: APP_APPLE_ID,
    environments: [Environment.PRODUCTION, Environment.SANDBOX],
    rootCertificates: [new X509Certificate(TEST_ROOT_CERT_PEM).raw],
    enableOnlineChecks: false,
    createApiClient: (environment) => ({
      async getTransactionInfo(transactionId: string) {
        apiCalls.push({ method: "getTransactionInfo", args: [environment, transactionId] });
        const signed = apiTransactions.get(`${environment}:${transactionId}`);
        if (!signed) {
          const { APIException } = await import("@apple/app-store-server-library");
          throw new APIException(404, 4040010, "Transaction id not found.");
        }
        return { signedTransactionInfo: signed };
      },
      async setAppAccountToken(originalTransactionId: string, request: unknown) {
        apiCalls.push({
          method: "setAppAccountToken",
          args: [environment, originalTransactionId, request],
        });
      },
    }),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// In-memory model fakes
// ---------------------------------------------------------------------------

type FakeAccount = {
  _id: string;
  badges: string[];
  activeBadges: string[];
  unlockedThemes: string[];
  activeSubscriptions: Record<string, unknown>[];
  appStoreAccountToken?: string;
  save: () => Promise<void>;
};

const accounts = new Map<string, FakeAccount>();
const purchases = new Map<string, Record<string, unknown> & { save: () => Promise<void> }>();
const notifications = new Set<string>();

function addAccount(id: string, patch: Partial<FakeAccount> = {}): FakeAccount {
  const account: FakeAccount = {
    _id: id,
    badges: [],
    activeBadges: [],
    unlockedThemes: [],
    activeSubscriptions: [],
    save: async () => {},
    ...patch,
  };
  accounts.set(id, account);
  return account;
}

function installModelFakes() {
  const ga = GameAccount as unknown as Record<string, unknown>;
  ga.findById = async (id: string) => accounts.get(String(id)) ?? null;
  ga.findOne = async (query: { appStoreAccountToken?: string }) =>
    [...accounts.values()].find((a) => a.appStoreAccountToken === query.appStoreAccountToken) ??
    null;
  ga.updateOne = async (query: { _id: string }, update: { $set: Record<string, unknown> }) => {
    const account = accounts.get(String(query._id));
    if (account && !account.appStoreAccountToken) Object.assign(account, update.$set);
    return { acknowledged: true };
  };
  ga.findByIdAndUpdate = async (id: string, update: { $addToSet: Record<string, string> }) => {
    const account = accounts.get(String(id)) as unknown as Record<string, string[]> | undefined;
    if (!account) return null;
    for (const [field, value] of Object.entries(update.$addToSet)) {
      if (!account[field].includes(value)) account[field].push(value);
    }
    return account;
  };

  const ap = AppStorePurchase as unknown as Record<string, unknown>;
  ap.findOne = async (query: { originalTransactionId: string }) =>
    purchases.get(query.originalTransactionId) ?? null;
  ap.create = async (doc: Record<string, unknown>) => {
    const key = String(doc.originalTransactionId);
    if (purchases.has(key)) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    const record = { ...doc, save: async () => {} };
    purchases.set(key, record);
    return record;
  };

  const an = AppStoreNotification as unknown as Record<string, unknown>;
  an.exists = async (query: { notificationUUID: string }) =>
    notifications.has(query.notificationUUID) ? { _id: query.notificationUUID } : null;
  an.create = async (doc: { notificationUUID: string }) => {
    if (notifications.has(doc.notificationUUID)) {
      throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    }
    notifications.add(doc.notificationUUID);
    return doc;
  };

  (Achievement as unknown as Record<string, unknown>).deleteOne = async () => ({});
}

const PLAYER_A = "64b000000000000000000001";
const PLAYER_B = "64b000000000000000000002";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("App Store product mapping", () => {
  test("every shop item maps to a unique App Store product id that round-trips", () => {
    const ids = SHOP_ITEMS.map(appStoreProductId);
    assert.equal(new Set(ids).size, ids.length);
    for (const item of SHOP_ITEMS) {
      assert.equal(findShopItemByAppStoreProductId(appStoreProductId(item)), item);
      assert.match(appStoreProductId(item), /^com\.ricoslabs\.tiao\.[a-z0-9.-]+$/);
    }
  });

  test("badges and themes are non-consumable, recurring items are subscriptions", () => {
    for (const item of SHOP_ITEMS) {
      assert.equal(
        appStoreProductType(item),
        item.recurring ? "auto_renewable_subscription" : "non_consumable",
      );
    }
    assert.equal(
      appStoreProductId(SHOP_ITEMS.find((i) => i.id === "patron")!),
      "com.ricoslabs.tiao.sub.patron.monthly",
    );
  });

  test("account tokens are stable lowercase UUID v5 values, distinct per player", () => {
    const a = appStoreAccountTokenFor(PLAYER_A);
    assert.equal(a, appStoreAccountTokenFor(PLAYER_A));
    assert.notEqual(a, appStoreAccountTokenFor(PLAYER_B));
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("App Store purchase verification", () => {
  let gateway: AppStoreGateway;

  beforeEach(() => {
    accounts.clear();
    purchases.clear();
    notifications.clear();
    apiCalls.length = 0;
    apiTransactions.clear();
    installModelFakes();
    gateway = buildGateway();
    addAccount(PLAYER_A);
    addAccount(PLAYER_B);
  });

  test("grants a verified non-consumable badge and binds the purchase to the player", async () => {
    const tx = transaction({
      productId: "com.ricoslabs.tiao.badge.supporter",
      appAccountToken: appStoreAccountTokenFor(PLAYER_A),
    });
    const result = await claimAppStorePurchase(gateway, PLAYER_A, {
      signedTransaction: signJws(tx),
    });

    assert.equal(result.entitled, true);
    assert.equal(result.itemType, "badge");
    assert.equal(result.itemId, "supporter");
    assert.deepEqual(accounts.get(PLAYER_A)!.badges, ["supporter"]);
    assert.equal(purchases.get(tx.originalTransactionId)!.playerId, PLAYER_A);
    assert.equal(accounts.get(PLAYER_A)!.appStoreAccountToken, appStoreAccountTokenFor(PLAYER_A));
  });

  test("grants a theme from a Production transaction", async () => {
    const tx = transaction({
      productId: "com.ricoslabs.tiao.theme.night",
      environment: "Production",
    });
    const result = await claimAppStorePurchase(gateway, PLAYER_A, {
      signedTransaction: signJws(tx),
    });
    assert.equal(result.entitled, true);
    assert.deepEqual(accounts.get(PLAYER_A)!.unlockedThemes, ["night"]);
    assert.equal(purchases.get(tx.originalTransactionId)!.environment, "Production");
  });

  test("replaying the same transaction is idempotent", async () => {
    const signed = signJws(transaction({ productId: "com.ricoslabs.tiao.badge.badge-7" }));
    await claimAppStorePurchase(gateway, PLAYER_A, { signedTransaction: signed });
    await claimAppStorePurchase(gateway, PLAYER_A, { signedTransaction: signed });
    assert.deepEqual(accounts.get(PLAYER_A)!.badges, ["badge-7"]);
    assert.equal(purchases.size, 1);
  });

  test("refuses a transaction whose appAccountToken belongs to another account", async () => {
    const tx = transaction({
      productId: "com.ricoslabs.tiao.badge.supporter",
      appAccountToken: appStoreAccountTokenFor(PLAYER_A),
    });
    await assert.rejects(
      claimAppStorePurchase(gateway, PLAYER_B, { signedTransaction: signJws(tx) }),
      { code: "PURCHASE_CLAIMED_BY_OTHER_ACCOUNT", status: 409 },
    );
    assert.deepEqual(accounts.get(PLAYER_B)!.badges, []);
  });

  test("a purchase claimed by one account cannot be restored into another", async () => {
    const signed = signJws(transaction({ productId: "com.ricoslabs.tiao.theme.ocean" }));
    await claimAppStorePurchase(gateway, PLAYER_A, { signedTransaction: signed });
    await assert.rejects(claimAppStorePurchase(gateway, PLAYER_B, { signedTransaction: signed }), {
      code: "PURCHASE_CLAIMED_BY_OTHER_ACCOUNT",
    });
    assert.deepEqual(accounts.get(PLAYER_B)!.unlockedThemes, []);
  });

  test("rejects a JWS whose payload was altered after signing", async () => {
    const signed = signJws(transaction({ productId: "com.ricoslabs.tiao.badge.supporter" }));
    const [header, , signature] = signed.split(".");
    const forged = Buffer.from(
      JSON.stringify(transaction({ productId: "com.ricoslabs.tiao.badge.badge-7" })),
    ).toString("base64url");
    await assert.rejects(
      claimAppStorePurchase(gateway, PLAYER_A, {
        signedTransaction: `${header}.${forged}.${signature}`,
      }),
      { code: "INVALID_SIGNED_DATA", status: 400 },
    );
    assert.deepEqual(accounts.get(PLAYER_A)!.badges, []);
  });

  test("rejects a JWS that does not chain to a trusted Apple root", async () => {
    // Same certificates, but the gateway trusts a different root.
    const strictGateway = buildGateway({
      rootCertificates: [new X509Certificate(TEST_LEAF_CERT_PEM).raw],
    });
    const signed = signJws(transaction({ productId: "com.ricoslabs.tiao.badge.supporter" }));
    await assert.rejects(
      claimAppStorePurchase(strictGateway, PLAYER_A, { signedTransaction: signed }),
      {
        code: "INVALID_SIGNED_DATA",
      },
    );
  });

  test("rejects a transaction for a different app", async () => {
    const signed = signJws(
      transaction({
        productId: "com.ricoslabs.tiao.badge.supporter",
        bundleId: "com.example.other",
      }),
    );
    await assert.rejects(claimAppStorePurchase(gateway, PLAYER_A, { signedTransaction: signed }), {
      code: "INVALID_SIGNED_DATA",
    });
  });

  test("rejects environments the server does not accept", async () => {
    const productionOnly = buildGateway({ environments: [Environment.PRODUCTION] });
    const signed = signJws(transaction({ productId: "com.ricoslabs.tiao.badge.supporter" }));
    await assert.rejects(
      claimAppStorePurchase(productionOnly, PLAYER_A, { signedTransaction: signed }),
      {
        code: "ENVIRONMENT_NOT_ACCEPTED",
      },
    );
  });

  test("rejects products that are not in the shop catalog", async () => {
    const signed = signJws(transaction({ productId: "com.ricoslabs.tiao.badge.creator" }));
    await assert.rejects(claimAppStorePurchase(gateway, PLAYER_A, { signedTransaction: signed }), {
      code: "UNKNOWN_PRODUCT",
    });
  });

  test("requires a proof", async () => {
    await assert.rejects(claimAppStorePurchase(gateway, PLAYER_A, { transactionId: "abc" }), {
      code: "MISSING_PROOF",
    });
  });

  test("Mac App Store: resolves a transaction id through the Server API (sandbox fallback)", async () => {
    const tx = transaction({ productId: "com.ricoslabs.tiao.theme.marble" });
    apiTransactions.set(`Sandbox:${tx.transactionId}`, signJws(tx));

    const result = await claimAppStorePurchase(gateway, PLAYER_A, {
      transactionId: tx.transactionId,
    });

    assert.equal(result.entitled, true);
    assert.deepEqual(accounts.get(PLAYER_A)!.unlockedThemes, ["marble"]);
    assert.deepEqual(
      apiCalls.filter((c) => c.method === "getTransactionInfo").map((c) => c.args[0]),
      ["Production", "Sandbox"],
    );
    // StoreKit 1 purchases get the account token attached afterwards.
    await new Promise((resolve) => setImmediate(resolve));
    const tokenCall = apiCalls.find((c) => c.method === "setAppAccountToken");
    assert.deepEqual(tokenCall?.args, [
      "Sandbox",
      tx.originalTransactionId,
      { appAccountToken: appStoreAccountTokenFor(PLAYER_A) },
    ]);
  });

  test("Mac App Store: unknown transaction id is a 404", async () => {
    await assert.rejects(claimAppStorePurchase(gateway, PLAYER_A, { transactionId: "999999" }), {
      code: "TRANSACTION_NOT_FOUND",
      status: 404,
    });
  });

  test("an already-expired subscription grants nothing", async () => {
    const tx = subscriptionTx({ expiresDate: Date.now() - DAY });
    const result = await claimAppStorePurchase(gateway, PLAYER_A, {
      signedTransaction: signJws(tx),
    });
    assert.equal(result.entitled, false);
    assert.equal(result.status, "expired");
    assert.deepEqual(accounts.get(PLAYER_A)!.badges, []);
    assert.deepEqual(accounts.get(PLAYER_A)!.activeSubscriptions, []);
  });
});

describe("App Store Server Notifications v2", () => {
  let gateway: AppStoreGateway;

  beforeEach(() => {
    accounts.clear();
    purchases.clear();
    notifications.clear();
    installModelFakes();
    gateway = buildGateway();
    addAccount(PLAYER_A, { appStoreAccountToken: appStoreAccountTokenFor(PLAYER_A) });
    addAccount(PLAYER_B);
  });

  test("subscription lifecycle: subscribe, turn off auto-renew, expire", async () => {
    const tx = subscriptionTx({ appAccountToken: appStoreAccountTokenFor(PLAYER_A) });
    const account = accounts.get(PLAYER_A)!;

    // SUBSCRIBED arrives before the client claims: matched via the token.
    let res = await handleAppStoreNotification(
      gateway,
      notification("SUBSCRIBED", tx, { subtype: "INITIAL_BUY", renewal: renewalInfo(tx) }),
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.handled, "applied");
    assert.deepEqual(account.badges, ["patron"]);
    assert.equal(account.activeSubscriptions.length, 1);
    assert.equal(
      account.activeSubscriptions[0].subscriptionId,
      `apple:${tx.originalTransactionId}`,
    );
    assert.equal(account.activeSubscriptions[0].provider, "apple");
    assert.equal(account.activeSubscriptions[0].status, "active");

    // Player turns off auto-renew: keeps the badge until the period ends.
    const offTx = { ...tx, signedDate: Date.now() + 1 };
    res = await handleAppStoreNotification(
      gateway,
      notification("DID_CHANGE_RENEWAL_STATUS", offTx, {
        subtype: "AUTO_RENEW_DISABLED",
        renewal: renewalInfo(offTx, { autoRenewStatus: 0 }),
      }),
    );
    assert.equal(account.activeSubscriptions[0].status, "canceled");
    assert.deepEqual(account.badges, ["patron"]);

    // The client re-claiming the same transaction must not flip it back.
    await claimAppStorePurchase(gateway, PLAYER_A, {
      signedTransaction: signJws({ ...tx, signedDate: Date.now() + 2 }),
    });
    assert.equal(account.activeSubscriptions[0].status, "canceled");

    // Period ends.
    const expiredTx = { ...tx, expiresDate: Date.now() - 1000, signedDate: Date.now() + 3 };
    res = await handleAppStoreNotification(
      gateway,
      notification("EXPIRED", expiredTx, {
        subtype: "VOLUNTARY",
        renewal: renewalInfo(expiredTx, { autoRenewStatus: 0 }),
      }),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(account.activeSubscriptions, []);
    assert.deepEqual(account.badges, []);
    assert.equal(purchases.get(tx.originalTransactionId)!.status, "expired");
  });

  test("renewal extends the period; billing retry marks it past due", async () => {
    const tx = subscriptionTx({ appAccountToken: appStoreAccountTokenFor(PLAYER_A) });
    await claimAppStorePurchase(gateway, PLAYER_A, { signedTransaction: signJws(tx) });
    const account = accounts.get(PLAYER_A)!;

    const renewed = {
      ...tx,
      transactionId: String(txCounter++),
      expiresDate: Date.now() + 60 * DAY,
      signedDate: Date.now() + 1,
    };
    await handleAppStoreNotification(
      gateway,
      notification("DID_RENEW", renewed, { renewal: renewalInfo(renewed) }),
    );
    assert.equal(
      (account.activeSubscriptions[0].currentPeriodEnd as Date).getTime(),
      renewed.expiresDate,
    );

    const failing = { ...renewed, signedDate: Date.now() + 2 };
    await handleAppStoreNotification(
      gateway,
      notification("DID_FAIL_TO_RENEW", failing, {
        subtype: "GRACE_PERIOD",
        renewal: renewalInfo(failing, {
          isInBillingRetryPeriod: true,
          gracePeriodExpiresDate: Date.now() + 70 * DAY,
        }),
      }),
    );
    assert.equal(account.activeSubscriptions[0].status, "past_due");
    assert.deepEqual(account.badges, ["patron"]);
  });

  test("a Stripe Patron subscription keeps the badge when the Apple one expires", async () => {
    const account = accounts.get(PLAYER_A)!;
    account.activeSubscriptions.push({
      subscriptionId: "sub_stripe",
      badgeId: "patron",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + DAY),
    });
    const tx = subscriptionTx({ appAccountToken: appStoreAccountTokenFor(PLAYER_A) });
    await claimAppStorePurchase(gateway, PLAYER_A, { signedTransaction: signJws(tx) });

    const expiredTx = { ...tx, expiresDate: Date.now() - 1000, signedDate: Date.now() + 1 };
    await handleAppStoreNotification(gateway, notification("EXPIRED", expiredTx));

    assert.deepEqual(account.badges, ["patron"]);
    assert.deepEqual(
      account.activeSubscriptions.map((s) => s.subscriptionId),
      ["sub_stripe"],
    );
  });

  test("refund revokes a theme, and a stale client JWS cannot restore it", async () => {
    const tx = transaction({ productId: "com.ricoslabs.tiao.theme.sakura" });
    const original = signJws(tx);
    await claimAppStorePurchase(gateway, PLAYER_A, { signedTransaction: original });
    const account = accounts.get(PLAYER_A)!;
    assert.deepEqual(account.unlockedThemes, ["sakura"]);

    const refunded = {
      ...tx,
      revocationDate: Date.now(),
      revocationReason: 0,
      signedDate: Date.now() + 1,
    };
    const res = await handleAppStoreNotification(gateway, notification("REFUND", refunded));
    assert.equal(res.body.handled, "applied");
    assert.deepEqual(account.unlockedThemes, []);
    assert.equal(purchases.get(tx.originalTransactionId)!.status, "revoked");

    const replay = await claimAppStorePurchase(gateway, PLAYER_A, { signedTransaction: original });
    assert.equal(replay.entitled, false);
    assert.deepEqual(account.unlockedThemes, []);

    // Apple reverses the refund.
    const reversed = { ...tx, signedDate: Date.now() + 2 };
    await handleAppStoreNotification(gateway, notification("REFUND_REVERSED", reversed));
    assert.deepEqual(account.unlockedThemes, ["sakura"]);
  });

  test("duplicate notifications are processed once", async () => {
    const tx = transaction({
      productId: "com.ricoslabs.tiao.badge.badge-3",
      appAccountToken: appStoreAccountTokenFor(PLAYER_A),
    });
    const uuid = randomUUID();
    const first = await handleAppStoreNotification(
      gateway,
      notification("ONE_TIME_CHARGE", tx, { uuid }),
    );
    const second = await handleAppStoreNotification(
      gateway,
      notification("ONE_TIME_CHARGE", tx, { uuid }),
    );
    assert.equal(first.body.handled, "applied");
    assert.equal(second.body.handled, "duplicate");
    assert.deepEqual(accounts.get(PLAYER_A)!.badges, ["badge-3"]);
  });

  test("notifications for purchases no account has claimed are acknowledged", async () => {
    const tx = transaction({ productId: "com.ricoslabs.tiao.badge.supporter" });
    const res = await handleAppStoreNotification(gateway, notification("ONE_TIME_CHARGE", tx));
    assert.equal(res.status, 200);
    assert.equal(res.body.handled, "unmatched");
    assert.equal(purchases.size, 0);
  });

  test("TEST notifications are acknowledged without side effects", async () => {
    const payload = signJws({
      notificationType: "TEST",
      notificationUUID: randomUUID(),
      version: "2.0",
      signedDate: Date.now(),
      data: { bundleId: APP_STORE_BUNDLE_ID, environment: "Sandbox" },
    });
    const res = await handleAppStoreNotification(gateway, payload);
    assert.equal(res.status, 200);
    assert.equal(res.body.handled, "ignored");
  });

  test("rejects payloads that fail signature verification", async () => {
    const tx = transaction({ productId: "com.ricoslabs.tiao.badge.supporter" });
    const signed = notification("ONE_TIME_CHARGE", tx);
    const tampered = `${signed.slice(0, -4)}AAAA`;
    const res = await handleAppStoreNotification(gateway, tampered);
    assert.equal(res.status, 400);
    assert.equal((await handleAppStoreNotification(gateway, undefined)).status, 400);
  });

  test("Production notifications must carry this app's Apple id", async () => {
    const tx = transaction({
      productId: "com.ricoslabs.tiao.badge.supporter",
      environment: "Production",
    });
    const payload = signJws({
      notificationType: "ONE_TIME_CHARGE",
      notificationUUID: randomUUID(),
      version: "2.0",
      signedDate: Date.now(),
      data: {
        appAppleId: 42,
        bundleId: APP_STORE_BUNDLE_ID,
        environment: "Production",
        signedTransactionInfo: signJws(tx),
      },
    });
    const res = await handleAppStoreNotification(gateway, payload);
    assert.equal(res.status, 400);
  });

  test("processAppStoreNotification ignores payloads without a UUID", async () => {
    const outcome = await processAppStoreNotification(gateway, { notificationType: "TEST" });
    assert.equal(outcome.handled, "ignored");
  });
});

describe("App Store gateway configuration", () => {
  test("is off unless configured", async () => {
    setAppStoreGatewayForTests(undefined);
    delete process.env.APPLE_IAP_ENABLED;
    const { getAppStoreGateway } = await import("../appStore/appStoreGateway");
    assert.equal(getAppStoreGateway(), null);
    setAppStoreGatewayForTests(undefined);
  });

  test("production requires the numeric app Apple id", async () => {
    const { getAppStoreGateway } = await import("../appStore/appStoreGateway");
    process.env.NODE_ENV = "production";
    try {
      setAppStoreGatewayForTests(undefined);
      delete process.env.APPLE_IAP_APP_APPLE_ID;
      assert.equal(getAppStoreGateway(), null);

      setAppStoreGatewayForTests(undefined);
      process.env.APPLE_IAP_APP_APPLE_ID = String(APP_APPLE_ID);
      assert.notEqual(getAppStoreGateway(), null);
    } finally {
      process.env.NODE_ENV = "test";
      delete process.env.APPLE_IAP_APP_APPLE_ID;
      setAppStoreGatewayForTests(undefined);
    }
  });
});
