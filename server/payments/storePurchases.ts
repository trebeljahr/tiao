import { randomBytes } from "node:crypto";
import { trackRevenue } from "../analytics/openpanel";
import {
  findShopItem,
  findShopItemBySteamItemId,
  type ShopItem,
  type ShopItemType,
} from "../config/shopCatalog";
import { grantBadge, grantTheme } from "../game/badgeService";
import StorePurchase, {
  type StoreProvider,
  type StorePurchaseStatus,
} from "../models/StorePurchase";
import {
  STEAM_ERR_ALREADY_COMMITTED,
  SteamApiError,
  type SteamMicroTxnClient,
} from "./steamMicroTxn";

/**
 * Store-side fulfillment shared by Steam Microtransactions and the
 * Microsoft Store. The grant itself is the same `grantBadge` /
 * `grantTheme` the Stripe webhook calls, so an item bought anywhere is
 * indistinguishable on the account.
 *
 * Idempotency rules:
 *   - Grant first, then mark the ledger row `granted`. A crash between
 *     the two leaves a `pending` row that the next finalize/reconcile
 *     re-grants, and the grant is `$addToSet`, so repeating it is a no-op.
 *   - A store transaction belongs to the account that first recorded it.
 *     Another Tiao account presenting the same Steam order or Microsoft
 *     collection item is refused instead of getting a second copy.
 */

export class StorePurchaseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StorePurchaseError";
  }
}

export type StorePurchaseRecord = {
  provider: StoreProvider;
  externalId: string;
  playerId: string;
  itemType: ShopItemType;
  itemId: string;
  status: StorePurchaseStatus;
  steamId?: string;
  transactionId?: string;
  createdAt: Date;
};

/** Persistence seam — Mongo in production, a Map in tests. */
export interface StorePurchaseLedger {
  /** Insert; resolves false when (provider, externalId) already exists. */
  insert(record: Omit<StorePurchaseRecord, "createdAt">): Promise<boolean>;
  find(provider: StoreProvider, externalId: string): Promise<StorePurchaseRecord | null>;
  listPending(
    provider: StoreProvider,
    playerId: string,
    limit: number,
  ): Promise<StorePurchaseRecord[]>;
  update(
    provider: StoreProvider,
    externalId: string,
    patch: { status: StorePurchaseStatus; transactionId?: string; failureReason?: string },
  ): Promise<void>;
}

export type EntitlementGranter = (playerId: string, item: ShopItem) => Promise<void>;

export const mongoStorePurchaseLedger: StorePurchaseLedger = {
  async insert(record) {
    try {
      await StorePurchase.create(record);
      return true;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return false;
      throw err;
    }
  },
  async find(provider, externalId) {
    return (await StorePurchase.findOne({
      provider,
      externalId,
    }).lean()) as StorePurchaseRecord | null;
  },
  async listPending(provider, playerId, limit) {
    return (await StorePurchase.find({ provider, playerId, status: "pending" })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()) as StorePurchaseRecord[];
  },
  async update(provider, externalId, patch) {
    await StorePurchase.updateOne(
      { provider, externalId },
      { $set: { ...patch, ...(patch.status === "granted" ? { grantedAt: new Date() } : {}) } },
    );
  },
};

export const defaultGranter: EntitlementGranter = async (playerId, item) => {
  if (item.type === "badge") await grantBadge(playerId, item.id);
  else await grantTheme(playerId, item.id);
};

export type OwnedLookup = (playerId: string, item: ShopItem) => Promise<boolean>;

export type StorePurchaseDeps = {
  ledger: StorePurchaseLedger;
  grant: EntitlementGranter;
  isOwned: OwnedLookup;
  steam: SteamMicroTxnClient | null;
  /** Revenue hook; defaults to OpenPanel. Amount is list price in USD cents. */
  onRevenue?: (playerId: string, item: ShopItem, provider: StoreProvider) => void;
  newOrderId?: () => string;
};

/** Random positive 48-bit integer as a decimal string — fits Steam's uint64 orderid. */
export function generateSteamOrderId(): string {
  return String(randomBytes(6).readUIntBE(0, 6) + 1);
}

function defaultRevenue(playerId: string, item: ShopItem, provider: StoreProvider) {
  trackRevenue(item.price, {
    profileId: playerId,
    currency: item.currency.toUpperCase(),
    item_type: item.type,
    item_id: item.id,
    mode: "payment",
    provider,
  });
}

/** Statuses after which a Steam order will never be capturable. */
const STEAM_TERMINAL_FAILURES = new Set([
  "Failed",
  "Refunded",
  "PartialRefund",
  "Chargedback",
  "RefundedSuspectedFraud",
  "RefundedFriendlyFraud",
]);

export type SteamFinalizeResult =
  | { status: "granted"; itemType: ShopItemType; itemId: string }
  | { status: "pending"; itemType: ShopItemType; itemId: string }
  | { status: "failed"; itemType: ShopItemType; itemId: string; reason: string };

export function createStorePurchaseService(deps: StorePurchaseDeps) {
  const onRevenue = deps.onRevenue ?? defaultRevenue;
  const newOrderId = deps.newOrderId ?? generateSteamOrderId;

  function requireSteam(): SteamMicroTxnClient {
    if (!deps.steam) {
      throw new StorePurchaseError(
        503,
        "STEAM_PURCHASES_NOT_CONFIGURED",
        "Steam purchases are not configured on this server.",
      );
    }
    return deps.steam;
  }

  function sellableOnSteam(itemType: unknown, itemId: unknown): ShopItem {
    if ((itemType !== "badge" && itemType !== "theme") || typeof itemId !== "string") {
      throw new StorePurchaseError(400, "MISSING_ITEM", "Specify itemType and itemId.");
    }
    const item = findShopItem(itemType, itemId);
    if (!item || item.recurring || item.steamItemId === undefined) {
      throw new StorePurchaseError(404, "ITEM_NOT_FOUND", "That item is not sold on Steam.");
    }
    return item;
  }

  /**
   * Step 1 of a Steam purchase: authenticate the ticket, record a pending
   * order, and ask Steam to show the approval dialog in the overlay.
   */
  async function startSteamPurchase(input: {
    playerId: string;
    itemType: unknown;
    itemId: unknown;
    ticket: unknown;
    language: unknown;
  }): Promise<{ orderId: string }> {
    const steam = requireSteam();
    const item = sellableOnSteam(input.itemType, input.itemId);
    if (typeof input.ticket !== "string" || !/^[0-9a-fA-F]{16,4096}$/.test(input.ticket)) {
      throw new StorePurchaseError(
        400,
        "INVALID_STEAM_TICKET",
        "A Steam session ticket is required.",
      );
    }
    if (await deps.isOwned(input.playerId, item)) {
      throw new StorePurchaseError(409, "ALREADY_OWNED", "You already own this item.");
    }

    let owner: Awaited<ReturnType<SteamMicroTxnClient["authenticateUserTicket"]>>;
    try {
      owner = await steam.authenticateUserTicket(input.ticket);
    } catch (err) {
      if (err instanceof SteamApiError && err.httpStatus === null) {
        throw new StorePurchaseError(
          401,
          "INVALID_STEAM_TICKET",
          "Steam could not verify this session.",
        );
      }
      throw err;
    }
    if (owner.publisherBanned) {
      throw new StorePurchaseError(
        403,
        "STEAM_ACCOUNT_BANNED",
        "This Steam account cannot make purchases.",
      );
    }

    const language =
      typeof input.language === "string" && /^[a-z]{2}$/.test(input.language)
        ? input.language
        : "en";

    // Collisions on a random 48-bit id are vanishingly rare; the unique
    // index turns one into a retry rather than a shared order.
    let orderId = "";
    for (let attempt = 0; attempt < 3 && !orderId; attempt++) {
      const candidate = newOrderId();
      const inserted = await deps.ledger.insert({
        provider: "steam",
        externalId: candidate,
        playerId: input.playerId,
        itemType: item.type,
        itemId: item.id,
        status: "pending",
        steamId: owner.steamId,
      });
      if (inserted) orderId = candidate;
    }
    if (!orderId) throw new Error("Could not allocate a unique Steam order id");

    try {
      const init = await steam.initTxn({
        orderId,
        steamId: owner.steamId,
        language,
        // Steam converts USD to the wallet currency at market rate.
        currency: item.currency.toUpperCase(),
        item: {
          itemId: item.steamItemId as number,
          amount: item.price,
          description: item.stripeName,
          category: item.type,
        },
      });
      if (init.transId) {
        await deps.ledger.update("steam", orderId, {
          status: "pending",
          transactionId: init.transId,
        });
      }
    } catch (err) {
      await deps.ledger.update("steam", orderId, {
        status: "failed",
        failureReason: err instanceof Error ? err.message : "init_failed",
      });
      throw new StorePurchaseError(
        502,
        "STEAM_INIT_FAILED",
        "Steam could not start this purchase.",
      );
    }

    return { orderId };
  }

  /**
   * Settle one Steam order: QueryTxn decides. Approved → FinalizeTxn then
   * grant; Succeeded → grant (finalized earlier, grant not yet recorded);
   * Init → still waiting on the player; anything terminal → failed.
   * Safe to call any number of times for the same order.
   */
  async function settleSteamOrder(
    steam: SteamMicroTxnClient,
    record: StorePurchaseRecord,
  ): Promise<SteamFinalizeResult> {
    const base = { itemType: record.itemType, itemId: record.itemId };
    if (record.status === "granted") return { status: "granted", ...base };
    if (record.status === "failed") return { status: "failed", reason: "order_closed", ...base };

    const item = findShopItem(record.itemType, record.itemId);
    if (!item)
      throw new Error(`Ledger references unknown item ${record.itemType}/${record.itemId}`);

    let txn = await steam.queryTxn(record.externalId);

    // The order must be the one we created: same buyer, same item.
    const line = txn.items[0];
    const lineItem = line ? findShopItemBySteamItemId(line.itemId) : undefined;
    if (
      (record.steamId && txn.steamId && txn.steamId !== record.steamId) ||
      !lineItem ||
      lineItem.type !== item.type ||
      lineItem.id !== item.id
    ) {
      await deps.ledger.update("steam", record.externalId, {
        status: "failed",
        failureReason: "txn_mismatch",
      });
      return { status: "failed", reason: "txn_mismatch", ...base };
    }

    if (txn.status === "Init") return { status: "pending", ...base };

    if (STEAM_TERMINAL_FAILURES.has(txn.status)) {
      await deps.ledger.update("steam", record.externalId, {
        status: "failed",
        failureReason: `steam_${txn.status}`,
      });
      return { status: "failed", reason: txn.status, ...base };
    }

    if (txn.status === "Approved") {
      try {
        await steam.finalizeTxn(record.externalId);
      } catch (err) {
        if (!(err instanceof SteamApiError && err.code === STEAM_ERR_ALREADY_COMMITTED)) throw err;
      }
      txn = await steam.queryTxn(record.externalId);
    }

    if (txn.status !== "Succeeded") {
      // Approved but the finalize did not stick; leave pending for retry.
      return { status: "pending", ...base };
    }

    await deps.grant(record.playerId, item);
    await deps.ledger.update("steam", record.externalId, {
      status: "granted",
      transactionId: txn.transId || record.transactionId,
    });
    onRevenue(record.playerId, item, "steam");
    return { status: "granted", ...base };
  }

  /** Step 2: called by the client after the overlay reports a decision. */
  async function finalizeSteamPurchase(input: {
    playerId: string;
    orderId: unknown;
  }): Promise<SteamFinalizeResult> {
    const steam = requireSteam();
    if (typeof input.orderId !== "string" || !/^\d{1,20}$/.test(input.orderId)) {
      throw new StorePurchaseError(400, "INVALID_ORDER", "Specify orderId.");
    }
    const record = await deps.ledger.find("steam", input.orderId);
    if (!record || record.playerId !== input.playerId) {
      throw new StorePurchaseError(404, "ORDER_NOT_FOUND", "Order not found.");
    }
    return settleSteamOrder(steam, record);
  }

  /**
   * Recover orders the player approved while the game crashed or lost
   * its connection before step 2 ran. Run when the shop opens.
   */
  async function reconcileSteamPurchases(playerId: string): Promise<SteamFinalizeResult[]> {
    const steam = requireSteam();
    const pending = await deps.ledger.listPending("steam", playerId, 10);
    const results: SteamFinalizeResult[] = [];
    for (const record of pending) {
      try {
        results.push(await settleSteamOrder(steam, record));
      } catch (err) {
        console.warn(`[store] Steam reconcile of order ${record.externalId} failed:`, err);
      }
    }
    return results;
  }

  return {
    startSteamPurchase,
    finalizeSteamPurchase,
    reconcileSteamPurchases,
  };
}

export type StorePurchaseService = ReturnType<typeof createStorePurchaseService>;
