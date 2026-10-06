process.env.TOKEN_SECRET = "test-secret";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/tiao-test";
process.env.S3_BUCKET_NAME = "tiao-test-assets";
process.env.S3_PUBLIC_URL = "https://assets.test.local";
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { findShopItem, type ShopItem } from "../config/shopCatalog";
import type { StoreProvider } from "../models/StorePurchase";
import {
  type FetchLike,
  SteamApiError,
  SteamMicroTxnClient,
  steamMicroTxnFromEnv,
} from "../payments/steamMicroTxn";
import {
  createStorePurchaseService,
  StorePurchaseError,
  type StorePurchaseLedger,
  type StorePurchaseRecord,
} from "../payments/storePurchases";

// ---------------------------------------------------------------------------
// Fake Steam partner API — enough of ISteamUserAuth + ISteamMicroTxn to
// drive the real client through every order state.
// ---------------------------------------------------------------------------

type FakeOrder = {
  orderid: string;
  transid: string;
  steamid: string;
  status: string;
  itemid: number;
  amount: number;
};

const PUBLISHER_KEY = "publisher-key-secret";
const TICKETS: Record<string, string> = {
  aabbccddeeff00112233: "76561198000000001",
  ffeeddccbbaa99887766: "76561198000000002",
};

class FakeSteam {
  orders = new Map<string, FakeOrder>();
  calls: Array<{ path: string; params: URLSearchParams; method: string }> = [];
  finalizeError: { errorcode: number; errordesc: string } | null = null;
  httpStatus = 200;

  fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const params = method === "POST" ? new URLSearchParams(init?.body ?? "") : u.searchParams;
    this.calls.push({ path: u.pathname, params, method });
    const reply = (body: unknown) => ({
      ok: this.httpStatus === 200,
      status: this.httpStatus,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    if (this.httpStatus !== 200) return reply("<html>Forbidden</html>");
    if (params.get("key") !== PUBLISHER_KEY) return { ...reply({}), ok: false, status: 403 };

    if (u.pathname === "/ISteamUserAuth/AuthenticateUserTicket/v1/") {
      const steamid = TICKETS[params.get("ticket") ?? ""];
      if (!steamid || params.get("identity") !== "tiao-iap") {
        return reply({ response: { error: { errorcode: 101, errordesc: "Invalid ticket" } } });
      }
      return reply({
        response: {
          params: {
            result: "OK",
            steamid,
            ownersteamid: steamid,
            vacbanned: false,
            publisherbanned: false,
          },
        },
      });
    }

    const op = u.pathname.split("/")[2];
    if (op === "InitTxn") {
      const orderid = params.get("orderid")!;
      const order: FakeOrder = {
        orderid,
        transid: `T${orderid}`,
        steamid: params.get("steamid")!,
        status: "Init",
        itemid: Number(params.get("itemid[0]")),
        amount: Number(params.get("amount[0]")),
      };
      this.orders.set(orderid, order);
      return reply({ response: { result: "OK", params: { orderid, transid: order.transid } } });
    }
    const order = this.orders.get(params.get("orderid") ?? "");
    if (!order) {
      return reply({
        response: { result: "Failure", error: { errorcode: 8, errordesc: "Order not found" } },
      });
    }
    if (op === "QueryTxn") {
      return reply({
        response: {
          result: "OK",
          params: {
            orderid: order.orderid,
            transid: order.transid,
            steamid: order.steamid,
            status: order.status,
            currency: "USD",
            items: [
              { itemid: order.itemid, qty: 1, amount: order.amount, itemstatus: order.status },
            ],
          },
        },
      });
    }
    if (op === "FinalizeTxn") {
      if (this.finalizeError) {
        return reply({ response: { result: "Failure", error: this.finalizeError } });
      }
      if (order.status !== "Approved") {
        return reply({
          response: { result: "Failure", error: { errorcode: 7, errordesc: "Not approved" } },
        });
      }
      order.status = "Succeeded";
      return reply({
        response: { result: "OK", params: { orderid: order.orderid, transid: order.transid } },
      });
    }
    throw new Error(`unexpected call ${u.pathname}`);
  };

  /** What the overlay does when the player clicks Authorize / Cancel. */
  approve(orderId: string) {
    this.orders.get(orderId)!.status = "Approved";
  }
  deny(orderId: string) {
    this.orders.get(orderId)!.status = "Failed";
  }
}

class MemoryLedger implements StorePurchaseLedger {
  rows = new Map<string, StorePurchaseRecord>();
  private k(p: StoreProvider, id: string) {
    return `${p}:${id}`;
  }
  async insert(record: Omit<StorePurchaseRecord, "createdAt">) {
    const key = this.k(record.provider, record.externalId);
    if (this.rows.has(key)) return false;
    this.rows.set(key, { ...record, createdAt: new Date() });
    return true;
  }
  async find(p: StoreProvider, id: string) {
    return this.rows.get(this.k(p, id)) ?? null;
  }
  async listPending(p: StoreProvider, playerId: string, limit: number) {
    return [...this.rows.values()]
      .filter((r) => r.provider === p && r.playerId === playerId && r.status === "pending")
      .slice(0, limit);
  }
  async update(
    p: StoreProvider,
    id: string,
    patch: { status: StorePurchaseRecord["status"]; transactionId?: string },
  ) {
    const row = this.rows.get(this.k(p, id));
    if (row) Object.assign(row, patch);
  }
}

const PLAYER = "64b000000000000000000001";
const OTHER_PLAYER = "64b000000000000000000002";
const TICKET = "aabbccddeeff00112233";

function setup() {
  const steamApi = new FakeSteam();
  const steam = new SteamMicroTxnClient({
    publisherKey: PUBLISHER_KEY,
    appId: 5035580,
    sandbox: false,
    fetch: steamApi.fetch,
    baseUrl: "https://partner.steam-api.test",
  });
  const ledger = new MemoryLedger();
  const owned = new Map<string, Set<string>>();
  const grants: Array<{ playerId: string; item: string }> = [];
  let nextOrder = 1000;
  const service = createStorePurchaseService({
    ledger,
    steam,
    grant: async (playerId, item: ShopItem) => {
      grants.push({ playerId, item: `${item.type}/${item.id}` });
      const set = owned.get(playerId) ?? new Set<string>();
      set.add(`${item.type}/${item.id}`);
      owned.set(playerId, set);
    },
    isOwned: async (playerId, item) => owned.get(playerId)?.has(`${item.type}/${item.id}`) ?? false,
    newOrderId: () => String(nextOrder++),
  });
  return { steamApi, steam, ledger, grants, service };
}

async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof StorePurchaseError, `expected StorePurchaseError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

// ---------------------------------------------------------------------------

describe("SteamMicroTxnClient", () => {
  test("InitTxn posts the publisher key and one item line, never in the URL", async () => {
    const { steamApi, steam } = setup();
    await steam.initTxn({
      orderId: "42",
      steamId: "76561198000000001",
      language: "de",
      currency: "USD",
      item: { itemId: 1001, amount: 299, description: "Supporter Badge — Classic Gold" },
    });
    const call = steamApi.calls.at(-1)!;
    assert.equal(call.method, "POST");
    assert.equal(call.path, "/ISteamMicroTxn/InitTxn/v3/");
    assert.equal(call.params.get("key"), PUBLISHER_KEY);
    assert.equal(call.params.get("appid"), "5035580");
    assert.equal(call.params.get("itemcount"), "1");
    assert.equal(call.params.get("usersession"), "client");
    assert.equal(call.params.get("itemid[0]"), "1001");
    assert.equal(call.params.get("amount[0]"), "299");
    assert.equal(call.params.get("language"), "de");
  });

  test("sandbox routes MicroTxn calls to ISteamMicroTxnSandbox", async () => {
    const steamApi = new FakeSteam();
    const steam = new SteamMicroTxnClient({
      publisherKey: PUBLISHER_KEY,
      appId: 5035580,
      sandbox: true,
      fetch: steamApi.fetch,
    });
    await steam.initTxn({
      orderId: "1",
      steamId: "1",
      language: "en",
      currency: "USD",
      item: { itemId: 1001, amount: 299, description: "x" },
    });
    assert.equal(steamApi.calls[0].path, "/ISteamMicroTxnSandbox/InitTxn/v3/");
  });

  test("Failure envelopes surface Steam's error code", async () => {
    const { steam } = setup();
    await assert.rejects(steam.queryTxn("999"), (err: unknown) => {
      assert.ok(err instanceof SteamApiError);
      assert.equal(err.code, 8);
      return true;
    });
  });

  test("HTTP errors do not echo the key", async () => {
    const { steamApi, steam } = setup();
    steamApi.httpStatus = 403;
    await assert.rejects(steam.queryTxn("1"), (err: unknown) => {
      assert.ok(err instanceof SteamApiError);
      assert.equal(err.httpStatus, 403);
      assert.ok(!err.message.includes(PUBLISHER_KEY));
      return true;
    });
  });

  test("AuthenticateUserTicket resolves the SteamID and rejects bad tickets", async () => {
    const { steam } = setup();
    const owner = await steam.authenticateUserTicket(TICKET);
    assert.equal(owner.steamId, "76561198000000001");
    await assert.rejects(steam.authenticateUserTicket("00"), SteamApiError);
  });

  test("steamMicroTxnFromEnv refuses the sandbox in production", () => {
    const env = {
      STEAM_PUBLISHER_WEB_API_KEY: "k",
      STEAM_APPID: "5035580",
      STEAM_MICROTXN_SANDBOX: "true",
    };
    assert.ok(steamMicroTxnFromEnv({ ...env, NODE_ENV: "development" }));
    assert.equal(steamMicroTxnFromEnv({ ...env, NODE_ENV: "production" }), null);
    assert.equal(steamMicroTxnFromEnv({ STEAM_APPID: "5035580" }), null);
  });
});

describe("Steam purchase flow", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  test("init → approve → finalize grants exactly once", async () => {
    const { service, steamApi, grants, ledger } = ctx;
    const { orderId } = await service.startSteamPurchase({
      playerId: PLAYER,
      itemType: "badge",
      itemId: "supporter",
      ticket: TICKET,
      language: "en",
    });
    const order = steamApi.orders.get(orderId)!;
    assert.equal(order.steamid, "76561198000000001");
    assert.equal(order.itemid, findShopItem("badge", "supporter")!.steamItemId);
    assert.equal(order.amount, 299);

    // Player has not clicked yet.
    const waiting = await service.finalizeSteamPurchase({ playerId: PLAYER, orderId });
    assert.equal(waiting.status, "pending");
    assert.equal(grants.length, 0);

    steamApi.approve(orderId);
    const done = await service.finalizeSteamPurchase({ playerId: PLAYER, orderId });
    assert.deepEqual(done, { status: "granted", itemType: "badge", itemId: "supporter" });
    assert.deepEqual(grants, [{ playerId: PLAYER, item: "badge/supporter" }]);
    assert.equal((await ledger.find("steam", orderId))?.status, "granted");

    // Retried finalize (double click, network retry) is a no-op.
    const again = await service.finalizeSteamPurchase({ playerId: PLAYER, orderId });
    assert.equal(again.status, "granted");
    assert.equal(grants.length, 1);
    assert.equal(
      steamApi.calls.filter((c) => c.path.endsWith("/FinalizeTxn/v2/")).length,
      1,
      "FinalizeTxn must run once",
    );
  });

  test("denied in the overlay → failed, nothing granted", async () => {
    const { service, steamApi, grants } = ctx;
    const { orderId } = await service.startSteamPurchase({
      playerId: PLAYER,
      itemType: "theme",
      itemId: "night",
      ticket: TICKET,
      language: "en",
    });
    steamApi.deny(orderId);
    const res = await service.finalizeSteamPurchase({ playerId: PLAYER, orderId });
    assert.equal(res.status, "failed");
    assert.equal(grants.length, 0);
  });

  test("finalized-but-not-granted (crash after FinalizeTxn) is recovered by reconcile", async () => {
    const { service, steamApi, grants } = ctx;
    const { orderId } = await service.startSteamPurchase({
      playerId: PLAYER,
      itemType: "badge",
      itemId: "badge-7",
      ticket: TICKET,
      language: "en",
    });
    // Captured on Steam's side, but our process died before granting.
    steamApi.orders.get(orderId)!.status = "Succeeded";
    const results = await service.reconcileSteamPurchases(PLAYER);
    assert.deepEqual(results, [{ status: "granted", itemType: "badge", itemId: "badge-7" }]);
    assert.deepEqual(grants, [{ playerId: PLAYER, item: "badge/badge-7" }]);
  });

  test("FinalizeTxn 'already committed' (code 6) still grants", async () => {
    const { service, steamApi, grants } = ctx;
    const { orderId } = await service.startSteamPurchase({
      playerId: PLAYER,
      itemType: "badge",
      itemId: "badge-2",
      ticket: TICKET,
      language: "en",
    });
    steamApi.approve(orderId);
    steamApi.finalizeError = { errorcode: 6, errordesc: "Transaction has already been committed" };
    // A concurrent finalize won the race and captured the order.
    const realFetch = steamApi.fetch;
    steamApi.fetch = async (url, init) => {
      if (url.includes("/FinalizeTxn/")) steamApi.orders.get(orderId)!.status = "Succeeded";
      return realFetch(url, init);
    };
    const { steam } = ctx;
    (steam as unknown as { fetchImpl: FetchLike }).fetchImpl = steamApi.fetch;
    const res = await service.finalizeSteamPurchase({ playerId: PLAYER, orderId });
    assert.equal(res.status, "granted");
    assert.equal(grants.length, 1);
  });

  test("another account cannot finalize someone else's order", async () => {
    const { service, steamApi, grants } = ctx;
    const { orderId } = await service.startSteamPurchase({
      playerId: PLAYER,
      itemType: "badge",
      itemId: "supporter",
      ticket: TICKET,
      language: "en",
    });
    steamApi.approve(orderId);
    await rejects(
      service.finalizeSteamPurchase({ playerId: OTHER_PLAYER, orderId }),
      "ORDER_NOT_FOUND",
    );
    assert.equal(grants.length, 0);
  });

  test("an order whose Steam record names a different buyer or item is refused", async () => {
    const { service, steamApi, grants } = ctx;
    const { orderId } = await service.startSteamPurchase({
      playerId: PLAYER,
      itemType: "badge",
      itemId: "supporter",
      ticket: TICKET,
      language: "en",
    });
    const order = steamApi.orders.get(orderId)!;
    order.status = "Approved";
    order.itemid = findShopItem("badge", "badge-7")!.steamItemId!;
    const res = await service.finalizeSteamPurchase({ playerId: PLAYER, orderId });
    assert.equal(res.status, "failed");
    assert.equal(grants.length, 0);
  });

  test("init rejects owned items, subscriptions, bad tickets, and missing config", async () => {
    const { service, steamApi } = ctx;
    const { orderId } = await service.startSteamPurchase({
      playerId: PLAYER,
      itemType: "badge",
      itemId: "supporter",
      ticket: TICKET,
      language: "en",
    });
    steamApi.approve(orderId);
    await service.finalizeSteamPurchase({ playerId: PLAYER, orderId });

    const base = { playerId: PLAYER, ticket: TICKET, language: "en" };
    await rejects(
      service.startSteamPurchase({ ...base, itemType: "badge", itemId: "supporter" }),
      "ALREADY_OWNED",
    );
    await rejects(
      service.startSteamPurchase({ ...base, itemType: "badge", itemId: "patron" }),
      "ITEM_NOT_FOUND",
    );
    await rejects(
      service.startSteamPurchase({ ...base, itemType: "badge", itemId: "creator" }),
      "ITEM_NOT_FOUND",
    );
    await rejects(
      service.startSteamPurchase({
        ...base,
        itemType: "theme",
        itemId: "night",
        ticket: "0011223344556677",
      }),
      "INVALID_STEAM_TICKET",
    );
    await rejects(
      service.startSteamPurchase({
        ...base,
        itemType: "theme",
        itemId: "night",
        ticket: "not hex",
      }),
      "INVALID_STEAM_TICKET",
    );

    const unconfigured = createStorePurchaseService({
      ledger: new MemoryLedger(),
      steam: null,
      grant: async () => {},
      isOwned: async () => false,
    });
    await rejects(
      unconfigured.startSteamPurchase({ ...base, itemType: "theme", itemId: "night" }),
      "STEAM_PURCHASES_NOT_CONFIGURED",
    );
  });

  test("an InitTxn failure closes the ledger row", async () => {
    const { service, steamApi, ledger } = ctx;
    const realFetch = steamApi.fetch;
    const failing: FetchLike = async (url, init) => {
      if (url.includes("/InitTxn/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            response: { result: "Failure", error: { errorcode: 2, errordesc: "Invalid param" } },
          }),
          text: async () => "",
        };
      }
      return realFetch(url, init);
    };
    (ctx.steam as unknown as { fetchImpl: FetchLike }).fetchImpl = failing;
    await rejects(
      service.startSteamPurchase({
        playerId: PLAYER,
        itemType: "theme",
        itemId: "ocean",
        ticket: TICKET,
        language: "en",
      }),
      "STEAM_INIT_FAILED",
    );
    const rows = [...ledger.rows.values()];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "failed");
  });

  test("every sellable item has a unique Steam item id", async () => {
    const { SHOP_ITEMS } = await import("../config/shopCatalog");
    const ids = SHOP_ITEMS.filter((i) => !i.recurring).map((i) => i.steamItemId);
    assert.ok(ids.every((id) => Number.isInteger(id) && (id as number) > 0));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(SHOP_ITEMS.filter((i) => i.recurring).every((i) => i.steamItemId === undefined));
  });
});
