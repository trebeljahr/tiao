import { createHash } from "node:crypto";
import type {
  JWSRenewalInfoDecodedPayload,
  JWSTransactionDecodedPayload,
  ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { trackGoal } from "../analytics/plausible";
import {
  appStoreProductType,
  findShopItemByAppStoreProductId,
  type ShopItem,
} from "../config/shopCatalog";
import { grantBadge, grantTheme, revokeBadge, revokeTheme } from "../game/badgeService";
import AppStoreNotification from "../models/AppStoreNotification";
import AppStorePurchase, {
  type AppStorePurchaseStatus,
  type IAppStorePurchase,
} from "../models/AppStorePurchase";
import GameAccount, { type ISubscription } from "../models/GameAccount";
import { type AppStoreGateway, AppStoreGatewayError } from "./appStoreGateway";

/**
 * Turns verified App Store transactions into the same entitlements Stripe
 * grants: badges and themes on the account, plus an `activeSubscriptions`
 * row for the Patron subscription.
 *
 * Every entry point is idempotent. State is derived from the newest
 * signed payload Apple produced for a purchase chain (revocationDate,
 * expiresDate, renewal info), not from counting events, so a replayed
 * client claim or a repeated notification lands on the same result.
 */

export class AppStoreClaimError extends AppStoreGatewayError {}

// ---------------------------------------------------------------------------
// appAccountToken
// ---------------------------------------------------------------------------

// Fixed namespace for Tiao account tokens (UUID v5). Never change it:
// tokens already attached to App Store transactions would stop matching.
const ACCOUNT_TOKEN_NAMESPACE = "3f0c6d52-9a1e-4c7b-8f2d-6b1e5a7c9d40";

/** RFC 4122 UUID v5 of `name` in `namespace`. */
function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(ns).update(name, "utf8").digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The UUID the client passes to StoreKit as `appAccountToken`. Apple
 * echoes it in every signed transaction and notification for the
 * purchase, which is how a notification finds its account and how a
 * claim from the wrong account is refused.
 *
 * Deterministic, so concurrent calls agree without a read-modify-write.
 */
export function appStoreAccountTokenFor(playerId: string): string {
  return uuidV5(playerId, ACCOUNT_TOKEN_NAMESPACE);
}

/** Store the token on the account so notifications can look it up. */
export async function ensureAppStoreAccountToken(playerId: string): Promise<string> {
  const token = appStoreAccountTokenFor(playerId);
  await GameAccount.updateOne(
    { _id: playerId, appStoreAccountToken: { $exists: false } },
    { $set: { appStoreAccountToken: token } },
  );
  return token;
}

// ---------------------------------------------------------------------------
// State derivation
// ---------------------------------------------------------------------------

export type AppStoreEntitlementResult = {
  originalTransactionId: string;
  productId: string;
  itemType: ShopItem["type"];
  itemId: string;
  status: AppStorePurchaseStatus;
  /** True when the player holds the item after this call. */
  entitled: boolean;
  expiresAt?: string;
};

type ApplyContext = {
  renewalInfo?: JWSRenewalInfoDecodedPayload;
  notificationType?: string;
  now?: Date;
};

const ENTITLED_STATUSES: ReadonlySet<AppStorePurchaseStatus> = new Set([
  "active",
  "past_due",
  "canceled",
]);

function deriveState(
  item: ShopItem,
  tx: JWSTransactionDecodedPayload,
  context: ApplyContext,
  existing: IAppStorePurchase | null,
): { status: AppStorePurchaseStatus; expiresAt?: Date } {
  if (tx.revocationDate) return { status: "revoked" };
  if (!item.recurring) return { status: "active" };

  const now = context.now ?? new Date();
  const renewal = context.renewalInfo;
  const end = Math.max(tx.expiresDate ?? 0, renewal?.gracePeriodExpiresDate ?? 0);
  const expiresAt = end > 0 ? new Date(end) : undefined;
  if (!expiresAt || expiresAt <= now) return { status: "expired", expiresAt };

  if (renewal?.isInBillingRetryPeriod || context.notificationType === "DID_FAIL_TO_RENEW") {
    return { status: "past_due", expiresAt };
  }
  if (renewal) {
    return { status: renewal.autoRenewStatus === 0 ? "canceled" : "active", expiresAt };
  }
  // A client claim carries no renewal info. For the transaction the
  // record already tracks, keep the auto-renew state a notification set.
  if (
    existing &&
    existing.transactionId === tx.transactionId &&
    (existing.status === "canceled" || existing.status === "past_due")
  ) {
    return { status: existing.status, expiresAt };
  }
  return { status: "active", expiresAt };
}

function toSubscriptionStatus(status: AppStorePurchaseStatus): ISubscription["status"] {
  return status === "past_due" || status === "canceled" ? status : "active";
}

async function syncAccountEntitlement(
  playerId: string,
  item: ShopItem,
  record: IAppStorePurchase,
): Promise<void> {
  const entitled = ENTITLED_STATUSES.has(record.status);
  const subscriptionId = `apple:${record.originalTransactionId}`;

  if (item.recurring) {
    const account = await GameAccount.findById(playerId);
    if (!account) {
      throw new AppStoreClaimError(404, "ACCOUNT_NOT_FOUND", "Player not found.");
    }
    const others = (account.activeSubscriptions ?? []).filter(
      (s: ISubscription) => s.subscriptionId !== subscriptionId,
    );
    account.activeSubscriptions = entitled
      ? [
          ...others,
          {
            subscriptionId,
            provider: "apple",
            badgeId: item.id,
            status: toSubscriptionStatus(record.status),
            currentPeriodEnd: record.expiresAt ?? new Date(),
          },
        ]
      : others;
    await account.save();

    if (entitled) {
      await grantBadge(playerId, item.id);
    } else {
      // Another subscription row for the same badge (a Stripe Patron
      // subscription) keeps it until that row is removed in turn.
      const stillCovered = others.some((s: ISubscription) => s.badgeId === item.id);
      if (!stillCovered) await revokeBadge(playerId, item.id);
    }
    return;
  }

  if (entitled) {
    if (item.type === "badge") await grantBadge(playerId, item.id);
    else await grantTheme(playerId, item.id);
  } else if (item.type === "badge") {
    await revokeBadge(playerId, item.id);
  } else {
    await revokeTheme(playerId, item.id);
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 11000;
}

/**
 * Apply one verified transaction to `playerId`. Creates the purchase
 * record on first sight (binding the chain to this player), refuses a
 * chain already bound to a different player, and skips payloads older
 * than the newest one applied.
 */
async function applyTransaction(
  playerId: string,
  tx: JWSTransactionDecodedPayload,
  context: ApplyContext,
): Promise<AppStoreEntitlementResult> {
  const productId = tx.productId ?? "";
  const item = findShopItemByAppStoreProductId(productId);
  if (!item) {
    throw new AppStoreClaimError(400, "UNKNOWN_PRODUCT", `Unknown App Store product: ${productId}`);
  }
  const originalTransactionId = tx.originalTransactionId;
  const transactionId = tx.transactionId;
  if (!originalTransactionId || !transactionId || !tx.signedDate) {
    throw new AppStoreClaimError(400, "INVALID_TRANSACTION", "Transaction is missing ids.");
  }
  const signedAt = new Date(tx.signedDate);

  let record = (await AppStorePurchase.findOne({
    originalTransactionId,
  })) as IAppStorePurchase | null;

  if (record && record.playerId !== playerId) {
    throw new AppStoreClaimError(
      409,
      "PURCHASE_CLAIMED_BY_OTHER_ACCOUNT",
      "This App Store purchase already belongs to a different Tiao account.",
    );
  }

  if (record && record.lastSignedAt > signedAt) {
    // Stale payload: report the stored state without touching anything.
    return resultFor(record);
  }

  const state = deriveState(item, tx, context, record);

  if (!record) {
    try {
      record = (await AppStorePurchase.create({
        originalTransactionId,
        transactionId,
        playerId,
        productId,
        itemType: item.type,
        itemId: item.id,
        kind: appStoreProductType(item),
        environment: String(tx.environment ?? "Production"),
        status: state.status,
        expiresAt: state.expiresAt,
        revokedAt: tx.revocationDate ? new Date(tx.revocationDate) : undefined,
        lastSignedAt: signedAt,
      })) as IAppStorePurchase;
    } catch (error) {
      // Another request bound the chain first; retry against its row.
      if (isDuplicateKeyError(error)) return applyTransaction(playerId, tx, context);
      throw error;
    }
  } else {
    record.transactionId = transactionId;
    record.status = state.status;
    record.expiresAt = state.expiresAt;
    record.revokedAt = tx.revocationDate ? new Date(tx.revocationDate) : undefined;
    record.lastSignedAt = signedAt;
    await record.save();
  }

  await syncAccountEntitlement(playerId, item, record);
  return resultFor(record);
}

function resultFor(record: IAppStorePurchase): AppStoreEntitlementResult {
  return {
    originalTransactionId: record.originalTransactionId,
    productId: record.productId,
    itemType: record.itemType,
    itemId: record.itemId,
    status: record.status,
    entitled: ENTITLED_STATUSES.has(record.status),
    expiresAt: record.expiresAt?.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Client claims (purchase + restore)
// ---------------------------------------------------------------------------

export type AppStoreProof = { signedTransaction?: unknown; transactionId?: unknown };

/**
 * Verify a purchase the client reports and grant it to `playerId`.
 *
 * iOS sends the StoreKit 2 `jwsRepresentation`; the Mac App Store build
 * (StoreKit 1 via Electron) sends a transaction id, which is resolved to
 * a signed transaction through the App Store Server API.
 */
export async function claimAppStorePurchase(
  gateway: AppStoreGateway,
  playerId: string,
  proof: AppStoreProof,
): Promise<AppStoreEntitlementResult> {
  let signedTransaction: string;
  if (typeof proof.signedTransaction === "string" && proof.signedTransaction) {
    signedTransaction = proof.signedTransaction;
  } else if (typeof proof.transactionId === "string" && /^\d{1,32}$/.test(proof.transactionId)) {
    if (!gateway.fetchSignedTransaction) {
      throw new AppStoreClaimError(
        503,
        "APP_STORE_API_NOT_CONFIGURED",
        "This server cannot look up App Store transactions.",
      );
    }
    signedTransaction = await gateway.fetchSignedTransaction(proof.transactionId);
  } else {
    throw new AppStoreClaimError(
      400,
      "MISSING_PROOF",
      "Send signedTransaction or a numeric transactionId.",
    );
  }

  const tx = await gateway.verifyTransaction(signedTransaction);
  const token = appStoreAccountTokenFor(playerId);
  if (tx.appAccountToken && tx.appAccountToken.toLowerCase() !== token) {
    throw new AppStoreClaimError(
      409,
      "PURCHASE_CLAIMED_BY_OTHER_ACCOUNT",
      "This App Store purchase was made from a different Tiao account.",
    );
  }

  await ensureAppStoreAccountToken(playerId);
  const result = await applyTransaction(playerId, tx, {});

  // StoreKit 1 cannot set appAccountToken at purchase time. Attach it now
  // so renewal and refund notifications can find the account even if
  // this purchase record is ever lost. Best effort.
  if (!tx.appAccountToken && gateway.setAppAccountToken && tx.originalTransactionId) {
    gateway
      .setAppAccountToken(tx.originalTransactionId, String(tx.environment), token)
      .catch((error) => console.warn("[appStore] setAppAccountToken failed:", error));
  }

  return result;
}

// ---------------------------------------------------------------------------
// App Store Server Notifications v2
// ---------------------------------------------------------------------------

export type NotificationOutcome =
  | { handled: "duplicate" | "ignored" | "unmatched" }
  | { handled: "applied"; result: AppStoreEntitlementResult };

/**
 * Apply a verified notification. Returns normally when Apple should stop
 * retrying (including notifications this server cannot act on); throws
 * when a retry might succeed (database errors).
 */
export async function processAppStoreNotification(
  gateway: AppStoreGateway,
  notification: ResponseBodyV2DecodedPayload,
): Promise<NotificationOutcome> {
  const notificationUUID = notification.notificationUUID;
  const notificationType = String(notification.notificationType ?? "");
  if (!notificationUUID) return { handled: "ignored" };

  if (await AppStoreNotification.exists({ notificationUUID })) {
    return { handled: "duplicate" };
  }

  const outcome = await applyNotification(gateway, notification, notificationType);

  try {
    await AppStoreNotification.create({
      notificationUUID,
      notificationType,
      subtype: notification.subtype ? String(notification.subtype) : undefined,
      originalTransactionId:
        outcome.handled === "applied" ? outcome.result.originalTransactionId : undefined,
      environment: notification.data?.environment
        ? String(notification.data.environment)
        : undefined,
      processedAt: new Date(),
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  return outcome;
}

async function applyNotification(
  gateway: AppStoreGateway,
  notification: ResponseBodyV2DecodedPayload,
  notificationType: string,
): Promise<NotificationOutcome> {
  const signedTransaction = notification.data?.signedTransactionInfo;
  if (notificationType === "TEST" || !signedTransaction) return { handled: "ignored" };

  const tx = await gateway.verifyTransaction(signedTransaction);
  const renewalInfo = notification.data?.signedRenewalInfo
    ? await gateway.verifyRenewalInfo(notification.data.signedRenewalInfo)
    : undefined;

  if (!tx.productId || !findShopItemByAppStoreProductId(tx.productId)) {
    console.warn(`[appStore] Notification for unknown product ${tx.productId}`);
    return { handled: "ignored" };
  }

  const existing = tx.originalTransactionId
    ? ((await AppStorePurchase.findOne({
        originalTransactionId: tx.originalTransactionId,
      })) as IAppStorePurchase | null)
    : null;
  let playerId = existing?.playerId;
  const token = tx.appAccountToken ?? renewalInfo?.appAccountToken;
  if (!playerId && token) {
    const account = await GameAccount.findOne({ appStoreAccountToken: token.toLowerCase() });
    if (account) playerId = String(account._id);
  }
  if (!playerId) {
    // The client claims the purchase itself once the app runs again.
    console.warn(
      `[appStore] ${notificationType} for unclaimed transaction ${tx.originalTransactionId}`,
    );
    return { handled: "unmatched" };
  }

  let result: AppStoreEntitlementResult;
  try {
    result = await applyTransaction(playerId, tx, { renewalInfo, notificationType });
  } catch (error) {
    // A conflict or bad payload will not fix itself on retry.
    if (error instanceof AppStoreClaimError) {
      console.warn(`[appStore] ${notificationType} not applied: ${error.code}`);
      return { handled: "ignored" };
    }
    throw error;
  }
  console.info(
    `[appStore] ${notificationType}${notification.subtype ? `/${notification.subtype}` : ""} -> ${result.itemType}/${result.itemId} ${result.status} for ${playerId}`,
  );
  if (notificationType === "SUBSCRIBED") {
    trackGoal("subscription_started", { badge_id: result.itemId, store: "app_store" });
  }
  return { handled: "applied", result };
}
