process.env.TOKEN_SECRET = "test-secret";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME = "tiao-test-assets";
process.env.S3_PUBLIC_URL = "https://assets.test.local";
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { SHOP_ITEMS, type ShopItem } from "../config/shopCatalog";
import type { StoreProvider } from "../models/StorePurchase";
import {
  checkStoreIdKey,
  MS_COLLECTIONS_AUDIENCE,
  MS_COLLECTIONS_KEY_AUDIENCE,
  type MsCollectionItem,
  MsStoreCollectionsClient,
  msStoreCollectionsFromEnv,
} from "../payments/msStoreCollections";
import type { FetchLike } from "../payments/steamMicroTxn";
import {
  createStorePurchaseService,
  StorePurchaseError,
  type StorePurchaseLedger,
  type StorePurchaseRecord,
} from "../payments/storePurchases";

// ---------------------------------------------------------------------------
// Fake Entra ID token endpoint + Microsoft Store collections service.
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 9, 5);
const SECRET = "entra-client-secret";

function b64url(obj: unknown) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

/** A Store ID key with real claim names; the signature is not checked by us. */
function storeKey(userId: string, overrides: Record<string, unknown> = {}) {
  return [
    b64url({ typ: "JWT", alg: "RS256" }),
    b64url({
      aud: "https://collections.mp.microsoft.com/v6.0/keys",
      iss: "https://collections.mp.microsoft.com/v6.0/keys",
      exp: NOW / 1000 + 30 * 86400,
      "http://schemas.microsoft.com/marketplace/2015/08/claims/key/userId": userId,
      ...overrides,
    }),
    "sig",
  ].join(".");
}

type FakeOwnership = Map<string, MsCollectionItem[]>; // storeKey → items

class FakeMicrosoft {
  tokenRequests: URLSearchParams[] = [];
  queries: Array<{ auth: string; body: Record<string, unknown> }> = [];
  ownership: FakeOwnership = new Map();
  pageSize = 100;
  collectionsStatus = 200;

  fetch: FetchLike = async (url, init) => {
    const ok = (body: unknown, status = 200) => ({
      ok: status === 200,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    if (url.startsWith("https://login.test/")) {
      const form = new URLSearchParams(init?.body ?? "");
      this.tokenRequests.push(form);
      if (form.get("client_secret") !== SECRET) return ok({ error: "invalid_client" }, 401);
      return ok({
        access_token: `tok:${form.get("resource")}:${this.tokenRequests.length}`,
        expires_in: "3599",
      });
    }
    if (url === "https://collections.test/query") {
      const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
      const auth = init?.headers?.Authorization ?? "";
      this.queries.push({ auth, body });
      if (this.collectionsStatus !== 200) return ok({}, this.collectionsStatus);
      if (!auth.startsWith(`Bearer tok:${MS_COLLECTIONS_AUDIENCE}:`)) return ok({}, 401);
      const [b] = body.beneficiaries as Array<{
        identityValue: string;
        localTicketReference: string;
      }>;
      const all = (this.ownership.get(b.identityValue) ?? []).map((i) => ({
        ...i,
        localTicketReference: b.localTicketReference,
      }));
      const start = Number(body.continuationToken ?? 0);
      const page = all.slice(start, start + this.pageSize);
      const next = start + this.pageSize < all.length ? String(start + this.pageSize) : undefined;
      return ok({ items: page, ...(next ? { continuationToken: next } : {}) });
    }
    throw new Error(`unexpected ${url}`);
  };
}

function durable(
  token: string,
  itemId: string,
  extra: Partial<MsCollectionItem> = {},
): MsCollectionItem {
  return {
    itemId,
    productId: `9N${itemId.toUpperCase().padEnd(10, "X").slice(0, 10)}`,
    skuId: "0010",
    inAppOfferToken: token,
    productType: "Durable",
    status: "Active",
    transactionId: `tx-${itemId}`,
    ...extra,
  };
}

class MemoryLedger implements StorePurchaseLedger {
  rows = new Map<string, StorePurchaseRecord>();
  async insert(record: Omit<StorePurchaseRecord, "createdAt">) {
    const key = `${record.provider}:${record.externalId}`;
    if (this.rows.has(key)) return false;
    this.rows.set(key, { ...record, createdAt: new Date() });
    return true;
  }
  async find(p: StoreProvider, id: string) {
    return this.rows.get(`${p}:${id}`) ?? null;
  }
  async listPending() {
    return [];
  }
  async update(p: StoreProvider, id: string, patch: { status: StorePurchaseRecord["status"] }) {
    const row = this.rows.get(`${p}:${id}`);
    if (row) Object.assign(row, patch);
  }
}

const ALICE = "64b0000000000000000000a1";
const BOB = "64b0000000000000000000b2";

function setup() {
  const microsoft = new FakeMicrosoft();
  let now = NOW;
  const client = new MsStoreCollectionsClient({
    tenantId: "tenant-guid",
    clientId: "client-guid",
    clientSecret: SECRET,
    fetch: microsoft.fetch,
    now: () => now,
    loginBaseUrl: "https://login.test",
    collectionsUrl: "https://collections.test/query",
  });
  const ledger = new MemoryLedger();
  const grants: string[] = [];
  const revenue: string[] = [];
  const service = createStorePurchaseService({
    ledger,
    steam: null,
    msStore: client,
    now: () => now,
    grant: async (playerId, item: ShopItem) => {
      grants.push(`${playerId}:${item.type}/${item.id}`);
    },
    isOwned: async () => false,
    onRevenue: (playerId, item, provider) => revenue.push(`${provider}:${playerId}:${item.id}`),
  });
  return {
    microsoft,
    client,
    ledger,
    grants,
    revenue,
    service,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

// ---------------------------------------------------------------------------

describe("MsStoreCollectionsClient", () => {
  test("mints client-credential tokens per audience and caches them", async () => {
    const { client, microsoft, advance } = setup();
    const a = await client.getAccessToken(MS_COLLECTIONS_AUDIENCE);
    const b = await client.getAccessToken(MS_COLLECTIONS_AUDIENCE);
    assert.equal(a, b);
    const ticket = await client.getCollectionsServiceTicket();
    assert.notEqual(ticket, a);
    assert.equal(microsoft.tokenRequests.length, 2);
    const first = microsoft.tokenRequests[0];
    assert.equal(first.get("grant_type"), "client_credentials");
    assert.equal(first.get("client_id"), "client-guid");
    assert.equal(microsoft.tokenRequests[1].get("resource"), MS_COLLECTIONS_KEY_AUDIENCE);

    // Refreshed inside the 5-minute safety window before expiry.
    advance(56 * 60_000);
    await client.getAccessToken(MS_COLLECTIONS_AUDIENCE);
    assert.equal(microsoft.tokenRequests.length, 3);
  });

  test("queries Valid Durables for the b2b beneficiary and follows continuation tokens", async () => {
    const { client, microsoft } = setup();
    const key = storeKey(ALICE);
    microsoft.pageSize = 2;
    microsoft.ownership.set(key, [
      durable("tiao.badge.supporter", "a1"),
      durable("tiao.theme.night", "a2"),
      durable("tiao.theme.ocean", "a3"),
    ]);
    const items = await client.queryOwnedDurables(key, ALICE);
    assert.equal(items.length, 3);
    assert.equal(microsoft.queries.length, 2);
    const body = microsoft.queries[0].body;
    assert.deepEqual(body.productTypes, ["Durable"]);
    assert.equal(body.validityType, "Valid");
    assert.deepEqual(body.beneficiaries, [
      { identityType: "b2b", identityValue: key, localTicketReference: ALICE },
    ]);
    assert.equal(microsoft.queries[1].body.continuationToken, "2");
  });

  test("checkStoreIdKey flags malformed, foreign-audience and expired keys", () => {
    assert.equal(checkStoreIdKey(storeKey(ALICE), NOW), null);
    assert.equal(checkStoreIdKey("not-a-jwt", NOW), "malformed");
    assert.equal(
      checkStoreIdKey(storeKey(ALICE, { aud: "https://purchase.mp.microsoft.com/v6.0/keys" }), NOW),
      "wrong_audience",
    );
    assert.equal(checkStoreIdKey(storeKey(ALICE, { exp: NOW / 1000 - 1 }), NOW), "expired");
  });

  test("msStoreCollectionsFromEnv needs all three Entra values", () => {
    assert.equal(
      msStoreCollectionsFromEnv({ MSSTORE_TENANT_ID: "t", MSSTORE_CLIENT_ID: "c" }),
      null,
    );
    assert.ok(
      msStoreCollectionsFromEnv({
        MSSTORE_TENANT_ID: "t",
        MSSTORE_CLIENT_ID: "c",
        MSSTORE_CLIENT_SECRET: "s",
      }),
    );
  });
});

describe("Microsoft Store entitlement sync", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  test("grants owned catalog add-ons once and restores them on later syncs", async () => {
    const { service, microsoft, grants, revenue } = ctx;
    const key = storeKey(ALICE);
    microsoft.ownership.set(key, [
      durable("tiao.badge.supporter", "a1"),
      durable("tiao.theme.night", "a2"),
      durable("some.other.game.addon", "a3"),
    ]);

    const first = await service.syncMsStorePurchases({ playerId: ALICE, storeIdKey: key });
    assert.deepEqual(first.granted, [
      { itemType: "badge", itemId: "supporter" },
      { itemType: "theme", itemId: "night" },
    ]);
    assert.deepEqual(first.restored, []);
    assert.equal(revenue.length, 2);

    const again = await service.syncMsStorePurchases({ playerId: ALICE, storeIdKey: key });
    assert.deepEqual(again.granted, []);
    assert.equal(again.restored.length, 2);
    assert.equal(revenue.length, 2, "revenue is recorded once per Store purchase");
    // Re-grant is idempotent ($addToSet) and repairs a manually removed item.
    assert.equal(grants.length, 4);
  });

  test("skips revoked, expired and non-durable items", async () => {
    const { service, microsoft, grants } = ctx;
    const key = storeKey(ALICE);
    microsoft.ownership.set(key, [
      durable("tiao.badge.supporter", "r1", { status: "Revoked" }),
      durable("tiao.badge.badge-1", "r2", { status: "Expired" }),
      durable("tiao.theme.night", "r3", { productType: "UnmanagedConsumable" }),
    ]);
    const res = await service.syncMsStorePurchases({ playerId: ALICE, storeIdKey: key });
    assert.deepEqual(res.granted, []);
    assert.equal(grants.length, 0);
  });

  test("one Store purchase binds to the first Tiao account that presents it", async () => {
    const { service, microsoft, grants } = ctx;
    // Same Store user signed in on the PC, two different Tiao accounts.
    const aliceKey = storeKey(ALICE);
    const bobKey = storeKey(BOB);
    const items = [durable("tiao.badge.badge-7", "shared-item")];
    microsoft.ownership.set(aliceKey, items);
    microsoft.ownership.set(bobKey, items);

    await service.syncMsStorePurchases({ playerId: ALICE, storeIdKey: aliceKey });
    const bob = await service.syncMsStorePurchases({ playerId: BOB, storeIdKey: bobKey });
    assert.deepEqual(bob.granted, []);
    assert.deepEqual(bob.claimedElsewhere, [{ itemType: "badge", itemId: "badge-7" }]);
    assert.deepEqual(grants, [`${ALICE}:badge/badge-7`]);
  });

  test("rejects bad keys before calling Microsoft, and maps Microsoft's 400", async () => {
    const { service, microsoft } = ctx;
    const expect = async (storeIdKey: unknown) =>
      assert.rejects(
        service.syncMsStorePurchases({ playerId: ALICE, storeIdKey }),
        (err: unknown) => {
          assert.ok(err instanceof StorePurchaseError);
          assert.equal(err.code, "INVALID_STORE_KEY");
          return true;
        },
      );
    await expect(undefined);
    await expect("garbage");
    await expect(storeKey(ALICE, { exp: NOW / 1000 - 60 }));
    assert.equal(microsoft.queries.length, 0);

    microsoft.collectionsStatus = 400;
    await expect(storeKey(ALICE));
  });

  test("issues the collections-key service ticket bound to the player", async () => {
    const { service } = ctx;
    const t = await service.issueMsStoreTicket(ALICE);
    assert.equal(t.publisherUserId, ALICE);
    assert.ok(t.serviceTicket.startsWith(`tok:${MS_COLLECTIONS_KEY_AUDIENCE}:`));
  });

  test("unconfigured server refuses Microsoft Store calls", async () => {
    const service = createStorePurchaseService({
      ledger: new MemoryLedger(),
      steam: null,
      msStore: null,
      grant: async () => {},
      isOwned: async () => false,
    });
    await assert.rejects(service.issueMsStoreTicket(ALICE), (err: unknown) => {
      assert.ok(err instanceof StorePurchaseError);
      assert.equal(err.code, "MSSTORE_PURCHASES_NOT_CONFIGURED");
      return true;
    });
  });

  test("every one-time catalog item has a unique Microsoft Store Product ID", () => {
    const tokens = SHOP_ITEMS.filter((i) => !i.recurring).map((i) => i.msStoreOfferToken);
    assert.ok(tokens.every((t) => typeof t === "string" && /^[a-z0-9.-]{1,50}$/.test(t)));
    assert.equal(new Set(tokens).size, tokens.length);
  });
});
