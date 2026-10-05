import type { ShopItem } from "../config/shopCatalog";
import { grantBadge, grantTheme, revokeBadge, revokeTheme } from "../game/badgeService";
import GameAccount, { type ISubscription } from "../models/GameAccount";
import PlayPurchase from "../models/PlayPurchase";
import {
  otherSubscriptionEntitles,
  type PlayEntitlementStore,
  type PlayPurchaseRecord,
} from "./googlePlayFulfillment";

function toRecord(doc: Record<string, unknown> | null): PlayPurchaseRecord | null {
  if (!doc) return null;
  return {
    purchaseToken: doc.purchaseToken as string,
    playerId: doc.playerId as string,
    productId: doc.productId as string,
    kind: doc.kind as PlayPurchaseRecord["kind"],
    itemType: doc.itemType as PlayPurchaseRecord["itemType"],
    itemId: doc.itemId as string,
    state: doc.state as string,
    orderId: (doc.orderId as string | undefined) ?? undefined,
    expiryTime: (doc.expiryTime as Date | undefined) ?? undefined,
    acknowledged: doc.acknowledged === true,
    testPurchase: doc.testPurchase === true,
    revokedAt: (doc.revokedAt as Date | undefined) ?? undefined,
    supersededBy: (doc.supersededBy as string | undefined) ?? undefined,
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

export const mongoPlayStore: PlayEntitlementStore = {
  async findPurchase(purchaseToken) {
    return toRecord(await PlayPurchase.findOne({ purchaseToken }).lean<Record<string, unknown>>());
  },

  async claimPurchase(record) {
    const { purchaseToken, ...fields } = record;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await PlayPurchase.findOneAndUpdate(
          { purchaseToken },
          { $setOnInsert: { purchaseToken, ...fields } },
          { upsert: true, new: true, includeResultMetadata: true, lean: true },
        );
        const created = result?.lastErrorObject?.updatedExisting === false;
        return { record: toRecord(result?.value ?? null) as PlayPurchaseRecord, created };
      } catch (err) {
        // Two upserts for the same new token: one inserts, the other hits
        // the unique index. The retry finds the inserted row.
        if (!isDuplicateKeyError(err) || attempt > 0) throw err;
      }
    }
    throw new Error("unreachable");
  },

  async updatePurchase(purchaseToken, patch) {
    const { purchaseToken: _ignored, playerId: _owner, ...rest } = patch;
    const $set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    if (Object.keys($set).length === 0) return;
    await PlayPurchase.updateOne({ purchaseToken }, { $set });
  },

  async findPlayerIdByPlayAccountId(playAccountId) {
    const account = await GameAccount.findOne({ googlePlayAccountId: playAccountId })
      .select("_id")
      .lean<{ _id: unknown }>();
    return account ? String(account._id) : null;
  },

  async grantItem(playerId, item: ShopItem) {
    if (item.type === "badge") await grantBadge(playerId, item.id);
    else await grantTheme(playerId, item.id);
  },

  async revokeItem(playerId, item: ShopItem, options) {
    if (item.type === "theme") {
      await revokeTheme(playerId, item.id);
      return;
    }
    if (item.recurring) {
      const account = await GameAccount.findById(playerId)
        .select("activeSubscriptions")
        .lean<{ activeSubscriptions?: ISubscription[] }>();
      if (
        otherSubscriptionEntitles(
          account?.activeSubscriptions ?? [],
          item.id,
          options?.exceptSubscriptionId,
          Date.now(),
        )
      ) {
        return;
      }
    }
    await revokeBadge(playerId, item.id);
  },

  async upsertSubscription(playerId, subscription) {
    const updated = await GameAccount.updateOne(
      { _id: playerId, "activeSubscriptions.subscriptionId": subscription.subscriptionId },
      { $set: { "activeSubscriptions.$": subscription } },
    );
    if (updated.matchedCount === 0) {
      await GameAccount.updateOne(
        {
          _id: playerId,
          "activeSubscriptions.subscriptionId": { $ne: subscription.subscriptionId },
        },
        { $push: { activeSubscriptions: subscription } },
      );
    }
  },

  async removeSubscription(playerId, subscriptionId) {
    await GameAccount.updateOne(
      { _id: playerId },
      { $pull: { activeSubscriptions: { subscriptionId } } },
    );
  },
};
