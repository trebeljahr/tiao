import { createHash } from "node:crypto";
import { track, trackRevenue } from "../analytics/openpanel";
import { findShopItemByPlayProductId, type ShopItem } from "../config/shopCatalog";
import type { ISubscription } from "../models/GameAccount";
import type { PlayPurchaseKind } from "../models/PlayPurchase";
import { type GooglePlayApi, GooglePlayApiError } from "./googlePlayApi";

/**
 * Google Play purchase verification and entitlement sync.
 *
 * Google is the source of truth: every entry point (the app's purchase
 * callback, restore, and Real-time Developer Notifications) re-reads the
 * purchase from the Play Developer API and converges our state on it.
 * That makes every path idempotent — running one twice, or all three for
 * the same token in any order, ends with the same entitlements.
 *
 * Entitlements land exactly where Stripe puts them: one-time items in
 * `GameAccount.badges` / `unlockedThemes`, subscriptions as a row in
 * `GameAccount.activeSubscriptions` plus the badge.
 */

/** Opaque per-account id handed to Play Billing as `obfuscatedAccountId` (max 64 chars). */
export function playAccountIdFor(playerId: string): string {
  return createHash("sha256").update(`tiao-google-play:${playerId}`).digest("hex");
}

export function playSubscriptionId(purchaseToken: string): string {
  return `play:${purchaseToken}`;
}

export type PlayPurchaseRecord = {
  purchaseToken: string;
  playerId: string;
  productId: string;
  kind: PlayPurchaseKind;
  itemType: "badge" | "theme";
  itemId: string;
  state: string;
  orderId?: string;
  expiryTime?: Date;
  acknowledged: boolean;
  testPurchase: boolean;
  revokedAt?: Date;
  supersededBy?: string;
};

export interface PlayEntitlementStore {
  findPurchase(purchaseToken: string): Promise<PlayPurchaseRecord | null>;
  /**
   * Insert the record unless the token is already stored. Returns whatever
   * is stored afterwards — possibly a row owned by another player.
   */
  claimPurchase(
    record: PlayPurchaseRecord,
  ): Promise<{ record: PlayPurchaseRecord; created: boolean }>;
  updatePurchase(purchaseToken: string, patch: Partial<PlayPurchaseRecord>): Promise<void>;
  findPlayerIdByPlayAccountId(playAccountId: string): Promise<string | null>;
  grantItem(playerId: string, item: ShopItem): Promise<void>;
  /**
   * Remove the item. For a subscription badge this is skipped while another
   * subscription row (other than `exceptSubscriptionId`) still entitles it.
   */
  revokeItem(
    playerId: string,
    item: ShopItem,
    options?: { exceptSubscriptionId?: string },
  ): Promise<void>;
  upsertSubscription(playerId: string, subscription: ISubscription): Promise<void>;
  removeSubscription(playerId: string, subscriptionId: string): Promise<void>;
}

/** Does any subscription row other than `exceptId` still entitle `badgeId`? */
export function otherSubscriptionEntitles(
  subscriptions: ISubscription[],
  badgeId: string,
  exceptId: string | undefined,
  now: number,
): boolean {
  return subscriptions.some((s) => {
    if (s.badgeId !== badgeId || s.subscriptionId === exceptId) return false;
    if (s.status === "active") return true;
    if (s.status === "canceled") return new Date(s.currentPeriodEnd).getTime() > now;
    // Stripe keeps the badge while past_due; a Play past_due row is on hold.
    return s.provider !== "google_play";
  });
}

export class PlayFulfillmentError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PlayFulfillmentError";
    this.status = status;
    this.code = code;
  }
}

export type PlayVerifyOutcome =
  | {
      status: "granted";
      itemType: "badge" | "theme";
      itemId: string;
      kind: PlayPurchaseKind;
      /** False when Google's acknowledge call failed; the next sync retries it. */
      acknowledged: boolean;
    }
  | { status: "pending" }
  | { status: "not_entitled"; state: string }
  /** No account could be tied to the token yet (RTDN before the app reported it). */
  | { status: "unattributed" };

export type DeveloperNotification = {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  subscriptionNotification?: {
    notificationType?: number;
    purchaseToken?: string;
    subscriptionId?: string;
  };
  oneTimeProductNotification?: {
    notificationType?: number;
    purchaseToken?: string;
    sku?: string;
  };
  voidedPurchaseNotification?: {
    purchaseToken?: string;
    orderId?: string;
    productType?: number;
  };
  testNotification?: { version?: string };
};

const ONE_TIME_PURCHASED = 0;
const ONE_TIME_CANCELED = 1;
const ONE_TIME_PENDING = 2;
const ONE_TIME_STATE_NAMES: Record<number, string> = {
  [ONE_TIME_PURCHASED]: "purchased",
  [ONE_TIME_CANCELED]: "canceled",
  [ONE_TIME_PENDING]: "pending",
};
/** ProductPurchase.purchaseType 0 = license-tester purchase. */
const PURCHASE_TYPE_TEST = 0;
/** oneTimeProductNotification.notificationType 1 = ONE_TIME_PRODUCT_PURCHASED. */
const RTDN_ONE_TIME_PURCHASED = 1;

export class PlayFulfillment {
  constructor(
    private readonly api: GooglePlayApi,
    private readonly store: PlayEntitlementStore,
    private readonly now: () => number = Date.now,
  ) {}

  get packageName(): string {
    return this.api.packageName;
  }

  /**
   * Verify one token and converge entitlements on Google's answer.
   * `claimantId` is the signed-in player for app calls, null for RTDN.
   */
  async verify(input: {
    productId: string;
    purchaseToken: string;
    claimantId: string | null;
  }): Promise<PlayVerifyOutcome> {
    const item = findShopItemByPlayProductId(input.productId);
    if (!item) {
      throw new PlayFulfillmentError(404, "ITEM_NOT_FOUND", "Unknown Google Play product.");
    }
    return item.recurring
      ? this.syncSubscription(item, input.purchaseToken, input.claimantId)
      : this.syncOneTime(item, input.purchaseToken, input.claimantId);
  }

  private async resolveOwner(
    existing: PlayPurchaseRecord | null,
    obfuscatedAccountId: string | undefined,
    claimantId: string | null,
  ): Promise<string | null> {
    if (existing) {
      if (claimantId && existing.playerId !== claimantId) {
        throw new PlayFulfillmentError(
          409,
          "PURCHASE_ALREADY_CLAIMED",
          "This purchase belongs to a different account.",
        );
      }
      return existing.playerId;
    }
    if (obfuscatedAccountId) {
      if (claimantId) {
        if (obfuscatedAccountId !== playAccountIdFor(claimantId)) {
          throw new PlayFulfillmentError(
            403,
            "PURCHASE_ACCOUNT_MISMATCH",
            "This purchase was made from a different account.",
          );
        }
        return claimantId;
      }
      return this.store.findPlayerIdByPlayAccountId(obfuscatedAccountId);
    }
    // No account id on the purchase (e.g. a promo code redeemed in the Play
    // Store app): the first signed-in player to report the token owns it.
    return claimantId;
  }

  private async claim(record: PlayPurchaseRecord): Promise<{ created: boolean }> {
    const result = await this.store.claimPurchase(record);
    if (result.record.playerId !== record.playerId) {
      throw new PlayFulfillmentError(
        409,
        "PURCHASE_ALREADY_CLAIMED",
        "This purchase belongs to a different account.",
      );
    }
    return { created: result.created };
  }

  private async syncOneTime(
    item: ShopItem,
    purchaseToken: string,
    claimantId: string | null,
  ): Promise<PlayVerifyOutcome> {
    const productId = item.googlePlay.productId;
    const purchase = await this.api.getProductPurchase(productId, purchaseToken);
    const existing = await this.store.findPurchase(purchaseToken);
    const owner = await this.resolveOwner(
      existing,
      purchase.obfuscatedExternalAccountId,
      claimantId,
    );
    if (!owner) return { status: "unattributed" };

    const state = ONE_TIME_STATE_NAMES[purchase.purchaseState ?? -1] ?? "unknown";
    if (existing?.revokedAt) return { status: "not_entitled", state: "voided" };

    const record: PlayPurchaseRecord = {
      purchaseToken,
      playerId: owner,
      productId,
      kind: "one_time",
      itemType: item.type,
      itemId: item.id,
      state,
      orderId: purchase.orderId,
      acknowledged: purchase.acknowledgementState === 1,
      testPurchase: purchase.purchaseType === PURCHASE_TYPE_TEST,
    };

    if (purchase.purchaseState === ONE_TIME_PENDING) {
      await this.claim(record);
      return { status: "pending" };
    }
    if (purchase.purchaseState !== ONE_TIME_PURCHASED) {
      if (existing) await this.store.updatePurchase(purchaseToken, { state });
      return { status: "not_entitled", state };
    }

    const { created } = await this.claim(record);
    const firstGrant = created || existing?.state !== "purchased";
    await this.store.grantItem(owner, item);

    let acknowledged = record.acknowledged;
    if (!acknowledged) {
      try {
        await this.api.acknowledgeProduct(productId, purchaseToken);
        acknowledged = true;
      } catch (err) {
        console.error(`[google-play] Acknowledge failed for ${productId}:`, err);
      }
    }
    await this.store.updatePurchase(purchaseToken, {
      state,
      acknowledged,
      orderId: purchase.orderId,
    });

    if (firstGrant) {
      console.info(`[google-play] Granted ${item.type} "${item.id}" to ${owner}`);
      // Play does not report the charged amount here, so revenue is the
      // catalog list price in USD — the same number Stripe's checkout uses.
      if (!record.testPurchase) {
        trackRevenue(item.price, {
          profileId: owner,
          currency: item.currency.toUpperCase(),
          item_type: item.type,
          item_id: item.id,
          mode: "payment",
          store: "google_play",
        });
      }
    }
    return {
      status: "granted",
      itemType: item.type,
      itemId: item.id,
      kind: "one_time",
      acknowledged,
    };
  }

  private async syncSubscription(
    item: ShopItem,
    purchaseToken: string,
    claimantId: string | null,
  ): Promise<PlayVerifyOutcome> {
    const productId = item.googlePlay.productId;
    const sub = await this.api.getSubscription(purchaseToken);
    const lineItem = sub.lineItems?.find((li) => li.productId === productId);
    if (!lineItem) {
      throw new PlayFulfillmentError(
        400,
        "PRODUCT_MISMATCH",
        "The purchase token is not for this subscription.",
      );
    }
    const existing = await this.store.findPurchase(purchaseToken);
    const owner = await this.resolveOwner(
      existing,
      sub.externalAccountIdentifiers?.obfuscatedExternalAccountId,
      claimantId,
    );
    if (!owner) return { status: "unattributed" };

    const state = sub.subscriptionState ?? "SUBSCRIPTION_STATE_UNSPECIFIED";
    const expiry = lineItem.expiryTime ? new Date(lineItem.expiryTime) : undefined;
    const subscriptionId = playSubscriptionId(purchaseToken);
    const record: PlayPurchaseRecord = {
      purchaseToken,
      playerId: owner,
      productId,
      kind: "subscription",
      itemType: item.type,
      itemId: item.id,
      state,
      orderId: sub.latestOrderId,
      expiryTime: expiry,
      acknowledged: sub.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      testPurchase: sub.testPurchase !== undefined,
    };

    if (state === "SUBSCRIPTION_STATE_PENDING") {
      await this.claim(record);
      return { status: "pending" };
    }
    if (state === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED") {
      if (existing) await this.store.updatePurchase(purchaseToken, { state });
      return { status: "not_entitled", state };
    }

    const { created } = await this.claim(record);
    if (sub.linkedPurchaseToken && sub.linkedPurchaseToken !== purchaseToken) {
      await this.supersede(sub.linkedPurchaseToken, purchaseToken);
    }

    const stillInPeriod = expiry !== undefined && expiry.getTime() > this.now();
    const status: ISubscription["status"] | null =
      state === "SUBSCRIPTION_STATE_ACTIVE"
        ? "active"
        : state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
          ? "past_due"
          : state === "SUBSCRIPTION_STATE_CANCELED" && stillInPeriod
            ? "canceled"
            : state === "SUBSCRIPTION_STATE_ON_HOLD" || state === "SUBSCRIPTION_STATE_PAUSED"
              ? "past_due"
              : null;
    const entitled =
      status !== null &&
      state !== "SUBSCRIPTION_STATE_ON_HOLD" &&
      state !== "SUBSCRIPTION_STATE_PAUSED" &&
      !existing?.supersededBy;
    const wasEntitled =
      !created &&
      existing !== null &&
      (existing.state === "SUBSCRIPTION_STATE_ACTIVE" ||
        existing.state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" ||
        existing.state === "SUBSCRIPTION_STATE_CANCELED");

    if (entitled && status) {
      await this.store.upsertSubscription(owner, {
        subscriptionId,
        badgeId: item.id,
        status,
        currentPeriodEnd: expiry ?? new Date(this.now()),
        provider: "google_play",
      });
      await this.store.grantItem(owner, item);

      let acknowledged = record.acknowledged;
      if (!acknowledged) {
        try {
          await this.api.acknowledgeSubscription(productId, purchaseToken);
          acknowledged = true;
        } catch (err) {
          console.error(`[google-play] Acknowledge failed for subscription ${productId}:`, err);
        }
      }
      await this.store.updatePurchase(purchaseToken, {
        state,
        acknowledged,
        expiryTime: expiry,
        orderId: sub.latestOrderId,
      });
      if (!wasEntitled) {
        console.info(`[google-play] Subscription badge "${item.id}" granted to ${owner}`);
        track("subscription_started", {
          profileId: owner,
          badge_id: item.id,
          store: "google_play",
        });
        if (!record.testPurchase) {
          trackRevenue(item.price, {
            profileId: owner,
            currency: item.currency.toUpperCase(),
            item_type: item.type,
            item_id: item.id,
            mode: "subscription",
            store: "google_play",
          });
        }
      }
      return {
        status: "granted",
        itemType: item.type,
        itemId: item.id,
        kind: "subscription",
        acknowledged,
      };
    }

    if (status === "past_due" && !existing?.supersededBy) {
      // On hold / paused: Google withholds access until payment recovers,
      // but the subscription can still come back, so keep its row.
      await this.store.upsertSubscription(owner, {
        subscriptionId,
        badgeId: item.id,
        status,
        currentPeriodEnd: expiry ?? new Date(this.now()),
        provider: "google_play",
      });
      await this.store.revokeItem(owner, item, { exceptSubscriptionId: subscriptionId });
    } else {
      // Expired, revoked, canceled past its period, or replaced by a newer token.
      await this.store.removeSubscription(owner, subscriptionId);
      if (!existing?.supersededBy) {
        await this.store.revokeItem(owner, item, { exceptSubscriptionId: subscriptionId });
      }
      if (wasEntitled && !existing?.supersededBy) {
        console.info(`[google-play] Subscription badge "${item.id}" revoked from ${owner}`);
        track("subscription_cancelled", {
          profileId: owner,
          badge_id: item.id,
          store: "google_play",
        });
      }
    }
    await this.store.updatePurchase(purchaseToken, { state, expiryTime: expiry });
    return { status: "not_entitled", state };
  }

  /** An upgrade or resubscribe replaced `oldToken`; drop its row without touching the badge. */
  private async supersede(oldToken: string, newToken: string): Promise<void> {
    const old = await this.store.findPurchase(oldToken);
    if (!old || old.supersededBy) return;
    await this.store.updatePurchase(oldToken, { supersededBy: newToken });
    await this.store.removeSubscription(old.playerId, playSubscriptionId(oldToken));
  }

  /** Refund or chargeback. One-time items are taken back; subscriptions re-sync. */
  async handleVoided(purchaseToken: string): Promise<void> {
    const record = await this.store.findPurchase(purchaseToken);
    if (!record) return; // never granted, nothing to take back
    if (record.kind === "subscription") {
      await this.verify({ productId: record.productId, purchaseToken, claimantId: null });
      return;
    }
    if (record.revokedAt) return;
    const item = findShopItemByPlayProductId(record.productId);
    await this.store.updatePurchase(purchaseToken, {
      revokedAt: new Date(this.now()),
      state: "voided",
    });
    if (item) await this.store.revokeItem(record.playerId, item);
    console.info(
      `[google-play] Voided purchase: revoked ${record.itemType} "${record.itemId}" from ${record.playerId}`,
    );
  }

  /**
   * Apply one Real-time Developer Notification. `retry: true` tells the
   * route to answer non-2xx so Pub/Sub redelivers.
   */
  async handleNotification(notification: DeveloperNotification): Promise<{ retry: boolean }> {
    if (notification.testNotification) {
      console.info("[google-play] RTDN test notification received");
      return { retry: false };
    }
    if (notification.packageName && notification.packageName !== this.api.packageName) {
      console.warn(`[google-play] RTDN for unexpected package ${notification.packageName}`);
      return { retry: false };
    }

    try {
      const sub = notification.subscriptionNotification;
      const oneTime = notification.oneTimeProductNotification;
      const voided = notification.voidedPurchaseNotification;

      if (sub?.purchaseToken && sub.subscriptionId) {
        const outcome = await this.verify({
          productId: sub.subscriptionId,
          purchaseToken: sub.purchaseToken,
          claimantId: null,
        });
        return { retry: outcome.status === "granted" && !outcome.acknowledged };
      }
      if (oneTime?.purchaseToken && oneTime.sku) {
        if (oneTime.notificationType !== RTDN_ONE_TIME_PURCHASED) {
          // A pending purchase was canceled — nothing was granted.
          const existing = await this.store.findPurchase(oneTime.purchaseToken);
          if (existing && existing.state === "pending") {
            await this.store.updatePurchase(oneTime.purchaseToken, { state: "canceled" });
          }
          return { retry: false };
        }
        const outcome = await this.verify({
          productId: oneTime.sku,
          purchaseToken: oneTime.purchaseToken,
          claimantId: null,
        });
        return { retry: outcome.status === "granted" && !outcome.acknowledged };
      }
      if (voided?.purchaseToken) {
        await this.handleVoided(voided.purchaseToken);
        return { retry: false };
      }
      console.warn("[google-play] RTDN with no known payload", Object.keys(notification));
      return { retry: false };
    } catch (err) {
      if (err instanceof PlayFulfillmentError) {
        console.warn(`[google-play] RTDN rejected: ${err.code} ${err.message}`);
        return { retry: false };
      }
      if (err instanceof GooglePlayApiError && err.isPermanent) {
        console.warn(`[google-play] RTDN token not usable: ${err.message}`);
        return { retry: false };
      }
      console.error("[google-play] RTDN processing failed, asking Pub/Sub to retry:", err);
      return { retry: true };
    }
  }
}
