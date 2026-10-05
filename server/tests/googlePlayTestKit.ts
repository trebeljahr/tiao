import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, type KeyObject, verify } from "node:crypto";
import type { ShopItem } from "../config/shopCatalog";
import type { ISubscription } from "../models/GameAccount";
import {
  GooglePlayApi,
  type ProductPurchase,
  type SubscriptionPurchaseV2,
} from "../payments/googlePlayApi";
import {
  otherSubscriptionEntitles,
  type PlayEntitlementStore,
  type PlayPurchaseRecord,
} from "../payments/googlePlayFulfillment";

/**
 * Stand-ins for Google and Mongo shared by the Play billing tests.
 *
 * FakeGooglePlay answers the OAuth token exchange (checking the JWT is
 * really signed by the service account key) and the androidpublisher
 * purchase endpoints from in-memory state.
 */

export const PACKAGE = "com.ricoslabs.tiao";

export class FakeGooglePlay {
  readonly keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  readonly products = new Map<string, ProductPurchase & { productId: string }>();
  readonly subscriptions = new Map<string, SubscriptionPurchaseV2>();
  readonly acks: string[] = [];
  tokenExchanges = 0;
  /** Status to answer every purchases.* call with, to simulate outages. */
  failWith: number | null = null;
  failAcks = false;
  now = Date.parse("2026-10-05T00:00:00Z");

  api(): GooglePlayApi {
    return new GooglePlayApi({
      packageName: PACKAGE,
      serviceAccount: {
        client_email: "play-api@test.iam.gserviceaccount.com",
        private_key: this.keys.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
        token_uri: "https://oauth2.googleapis.com/token",
      },
      fetchImpl: (url, init) => this.fetch(url, init),
      now: () => this.now,
    });
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  private async fetch(url: string, init?: RequestInit): Promise<Response> {
    if (url === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      const [h, c, s] = (form.get("assertion") ?? "").split(".");
      const signed = verify(
        "RSA-SHA256",
        Buffer.from(`${h}.${c}`),
        this.keys.publicKey,
        Buffer.from(s, "base64url"),
      );
      assert.ok(signed, "assertion must be signed with the service account key");
      const claims = JSON.parse(Buffer.from(c, "base64url").toString());
      assert.equal(claims.scope, "https://www.googleapis.com/auth/androidpublisher");
      this.tokenExchanges++;
      return this.json(200, { access_token: "ya29.test", expires_in: 3600 });
    }

    const prefix = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
    assert.ok(url.startsWith(prefix), `unexpected URL ${url}`);
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer ya29.test");
    if (this.failWith) return this.json(this.failWith, { error: { message: "simulated" } });
    const path = url.slice(prefix.length);

    let m = /^\/purchases\/products\/([^/]+)\/tokens\/([^/:]+)(:acknowledge)?$/.exec(path);
    if (m) {
      const [, productId, token, ack] = m.map((p) => (p ? decodeURIComponent(p) : p));
      const purchase = this.products.get(token);
      if (!purchase || purchase.productId !== productId) {
        return this.json(404, {
          error: { message: "not found", errors: [{ reason: "purchaseTokenNotFound" }] },
        });
      }
      if (ack) {
        assert.equal(init?.method, "POST");
        if (this.failAcks) return this.json(503, { error: { message: "busy" } });
        purchase.acknowledgementState = 1;
        this.acks.push(token);
        return new Response("", { status: 200 });
      }
      return this.json(200, purchase);
    }

    m = /^\/purchases\/subscriptionsv2\/tokens\/([^/]+)$/.exec(path);
    if (m) {
      const sub = this.subscriptions.get(decodeURIComponent(m[1]));
      return sub ? this.json(200, sub) : this.json(410, { error: { message: "gone" } });
    }

    m = /^\/purchases\/subscriptions\/([^/]+)\/tokens\/([^/:]+):acknowledge$/.exec(path);
    if (m) {
      const token = decodeURIComponent(m[2]);
      const sub = this.subscriptions.get(token);
      if (!sub) return this.json(404, { error: { message: "not found" } });
      if (this.failAcks) return this.json(503, { error: { message: "busy" } });
      sub.acknowledgementState = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
      this.acks.push(token);
      return new Response("", { status: 200 });
    }

    return this.json(404, { error: { message: `no route ${path}` } });
  }

  addProduct(token: string, productId: string, fields: Partial<ProductPurchase> = {}) {
    this.products.set(token, {
      productId,
      orderId: `GPA.${token}`,
      purchaseState: 0,
      acknowledgementState: 0,
      ...fields,
    });
  }

  addSubscription(
    token: string,
    state: SubscriptionPurchaseV2["subscriptionState"],
    fields: Partial<SubscriptionPurchaseV2> & { expiresInDays?: number } = {},
  ) {
    const { expiresInDays = 30, ...rest } = fields;
    this.subscriptions.set(token, {
      subscriptionState: state,
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
      latestOrderId: `GPA.${token}`,
      lineItems: [
        {
          productId: "sub_patron",
          expiryTime: new Date(this.now + expiresInDays * 86_400_000).toISOString(),
          offerDetails: { basePlanId: "monthly" },
        },
      ],
      ...rest,
    });
  }
}

type FakeAccount = { badges: Set<string>; themes: Set<string>; subs: ISubscription[] };

/** In-memory PlayEntitlementStore with the same revoke rule as the Mongo one. */
export class MemoryPlayStore implements PlayEntitlementStore {
  readonly purchases = new Map<string, PlayPurchaseRecord>();
  readonly accounts = new Map<string, FakeAccount>();
  readonly playAccountIds = new Map<string, string>();
  constructor(private readonly now: () => number) {}

  account(playerId: string): FakeAccount {
    let account = this.accounts.get(playerId);
    if (!account) {
      account = { badges: new Set(), themes: new Set(), subs: [] };
      this.accounts.set(playerId, account);
    }
    return account;
  }

  async findPurchase(token: string) {
    const record = this.purchases.get(token);
    return record ? { ...record } : null;
  }
  async claimPurchase(record: PlayPurchaseRecord) {
    const existing = this.purchases.get(record.purchaseToken);
    if (existing) return { record: { ...existing }, created: false };
    this.purchases.set(record.purchaseToken, { ...record });
    return { record: { ...record }, created: true };
  }
  async updatePurchase(token: string, patch: Partial<PlayPurchaseRecord>) {
    const record = this.purchases.get(token);
    if (!record) return;
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined && k !== "playerId" && k !== "purchaseToken") {
        (record as Record<string, unknown>)[k] = v;
      }
    }
  }
  async findPlayerIdByPlayAccountId(id: string) {
    return this.playAccountIds.get(id) ?? null;
  }
  async grantItem(playerId: string, item: ShopItem) {
    (item.type === "badge" ? this.account(playerId).badges : this.account(playerId).themes).add(
      item.id,
    );
  }
  async revokeItem(playerId: string, item: ShopItem, options?: { exceptSubscriptionId?: string }) {
    const account = this.account(playerId);
    if (
      item.recurring &&
      otherSubscriptionEntitles(account.subs, item.id, options?.exceptSubscriptionId, this.now())
    ) {
      return;
    }
    (item.type === "badge" ? account.badges : account.themes).delete(item.id);
  }
  async upsertSubscription(playerId: string, sub: ISubscription) {
    const account = this.account(playerId);
    const index = account.subs.findIndex((s) => s.subscriptionId === sub.subscriptionId);
    if (index >= 0) account.subs[index] = { ...sub };
    else account.subs.push({ ...sub });
  }
  async removeSubscription(playerId: string, subscriptionId: string) {
    const account = this.account(playerId);
    account.subs = account.subs.filter((s) => s.subscriptionId !== subscriptionId);
  }
}

/** Google-style OIDC token for Pub/Sub push, signed with `key`. */
export function signOidcToken(
  key: KeyObject,
  kid: string,
  claims: Record<string, unknown>,
): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(key).toString("base64url")}`;
}

export function encodeNotification(notification: Record<string, unknown>) {
  return {
    message: {
      data: Buffer.from(JSON.stringify({ packageName: PACKAGE, ...notification })).toString(
        "base64",
      ),
      messageId: "1",
    },
    subscription: "projects/test/subscriptions/play-rtdn",
  };
}
