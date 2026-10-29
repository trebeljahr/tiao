import { grantBadge, grantTheme } from "../game/badgeService";
import AppStorePurchase from "../models/AppStorePurchase";
import GameAccount from "../models/GameAccount";
import PlayPurchase from "../models/PlayPurchase";
import StorePurchase from "../models/StorePurchase";
import StripePurchase from "../models/StripePurchase";
import {
  otherSubscriptionEntitles,
  type StripePurchaseRecord,
  type StripeShopStore,
} from "./stripeShop";

export const mongoStripeShop: StripeShopStore = {
  async reserve(record) {
    // Do not accept purchases until the database enforces the concurrent-attempt lock.
    await StripePurchase.init();
    try {
      return (await StripePurchase.findOneAndUpdate(
        { purchaseKey: record.purchaseKey, active: true },
        { $setOnInsert: record },
        { upsert: true, new: true, lean: true },
      )) as unknown as StripePurchaseRecord;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await StripePurchase.findOne({
        purchaseKey: record.purchaseKey,
        active: true,
      }).lean();
      if (!existing) throw error;
      return existing as unknown as StripePurchaseRecord;
    }
  },
  async update(id, patch) {
    await StripePurchase.updateOne({ _id: id }, { $set: patch });
  },
  async findSession(sessionId) {
    return (await StripePurchase.findOne({
      sessionId,
    }).lean()) as unknown as StripePurchaseRecord | null;
  },
  async findAttempt(id) {
    return (await StripePurchase.findById(id).lean()) as unknown as StripePurchaseRecord | null;
  },
  async grant(playerId, item) {
    if (item.type === "badge") await grantBadge(playerId, item.id);
    else await grantTheme(playerId, item.id);
  },
  async revoke(playerId, item, exceptSession) {
    const account = await GameAccount.findById(playerId);
    if (!account) throw new Error("Purchase account not found.");
    if (
      item.recurring &&
      otherSubscriptionEntitles(
        account.activeSubscriptions ?? [],
        item.id,
        exceptSession,
        Date.now(),
      )
    )
      return;
    if (!item.recurring) {
      const match = { playerId, itemType: item.type, itemId: item.id };
      const other = await Promise.all([
        StripePurchase.exists({ ...match, sessionId: { $ne: exceptSession }, state: "granted" }),
        StorePurchase.exists({ ...match, status: "granted" }),
        PlayPurchase.exists({ ...match, state: "purchased", revokedAt: { $exists: false } }),
        AppStorePurchase.exists({ ...match, status: "active" }),
      ]);
      if (other.some(Boolean)) return;
    }
    // The conditional update also protects against a subscription granted
    // after the read above. A DB failure propagates so Stripe retries.
    const filter: Record<string, unknown> = { _id: playerId };
    if (item.recurring)
      filter.activeSubscriptions = {
        $not: {
          $elemMatch: {
            badgeId: item.id,
            subscriptionId: { $ne: exceptSession },
            accessSuspended: { $ne: true },
            $or: [
              { status: "active" },
              { status: "past_due", provider: { $ne: "google_play" } },
              { status: "canceled", currentPeriodEnd: { $gt: new Date() } },
            ],
          },
        },
      };
    await GameAccount.updateOne(filter, {
      $pull:
        item.type === "badge"
          ? { badges: item.id, activeBadges: item.id }
          : { unlockedThemes: item.id },
    });
  },
  async putSubscription(playerId, subscription) {
    const result = await GameAccount.updateOne(
      { _id: playerId, "activeSubscriptions.subscriptionId": subscription.subscriptionId },
      { $set: { "activeSubscriptions.$": subscription } },
    );
    if (!result.matchedCount) {
      const inserted = await GameAccount.updateOne(
        {
          _id: playerId,
          "activeSubscriptions.subscriptionId": { $ne: subscription.subscriptionId },
        },
        { $push: { activeSubscriptions: subscription } },
      );
      if (!inserted.matchedCount && !(await GameAccount.exists({ _id: playerId }))) {
        throw new Error("Subscription account not found.");
      }
    }
  },
  async removeSubscription(playerId, id) {
    await GameAccount.updateOne(
      { _id: playerId },
      { $pull: { activeSubscriptions: { subscriptionId: id } } },
    );
  },
};
