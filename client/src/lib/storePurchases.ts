/**
 * Which payment path the shop uses in the running client, and the
 * platform-store purchase flows.
 *
 *   - `stripe` — web and direct/itch desktop builds: Stripe Checkout.
 *   - `steam`  — Steam build: Steam Microtransactions through the overlay.
 *   - `google_play` — Android app: Google Play Billing (GooglePlayBridge).
 *   - `msstore` — Microsoft Store (AppX) build: Store add-on purchases.
 *   - `app_store` — iOS app and Mac App Store build: StoreKit In-App
 *                Purchase (AppStoreBridge).
 *   - `none`   — a store build that cannot sell yet (server not
 *                configured, or an old desktop without the bridge). The
 *                shop stays hidden, as store rules forbid an external
 *                payment link.
 *   - `loading` — a store build still waiting for /shop/iap/config.
 *                Treated as hidden, but pages should not redirect away
 *                until it settles.
 *
 * The store-side answer depends on the API server's /shop/iap/config. Render paths use
 * `useStorePurchaseChannel()` to re-render when it does.
 */

import { useEffect, useSyncExternalStore } from "react";
import {
  getStoreKitAdapter,
  getStoreKitRail,
  hasAppStorePurchaseBridge,
  StoreKitPendingError,
  type StoreProof,
} from "./AppStoreBridge";
import {
  ApiError,
  type AppStorePurchaseResult,
  finalizeSteamPurchase,
  type GooglePlayVerifyResult,
  getGooglePlayConfig,
  getMsStoreTicket,
  getStorePurchaseConfig,
  type MsStoreSyncResult,
  prepareAppStorePurchase,
  restoreAppStorePurchases,
  restoreGooglePlayPurchases,
  type StorePurchaseConfig,
  type StorePurchaseResult,
  startSteamPurchase,
  syncMsStorePurchases,
  verifyAppStorePurchase,
  verifyGooglePlayPurchase,
} from "./api";
import { isAppStoreChannel } from "./distributionChannel";
import {
  GooglePlayPurchaseError,
  hasGooglePlayBillingBridge,
  isAndroidApp,
  launchGooglePlayPurchase,
  listGooglePlayPurchases,
} from "./GooglePlayBridge";
import {
  getMsStoreCollectionsId,
  hasMsStorePurchaseBridge,
  isMsStoreBuild,
  requestMsStorePurchase,
} from "./MsStoreBridge";
import {
  getSteamWebApiTicket,
  hasSteamPurchaseBridge,
  isSteamBuild,
  waitForSteamMicroTxnAuthorization,
} from "./SteamBridge";

export type StorePurchaseChannel =
  | "stripe"
  | "steam"
  | "google_play"
  | "msstore"
  | "app_store"
  | "none"
  | "loading";

let config: StorePurchaseConfig | null = null;
let loading: Promise<void> | null = null;
/** True once a config fetch has finished, successfully or not. */
let settled = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Fetch /shop/iap/config once per session. Store builds only. */
export function loadStorePurchaseConfig(): Promise<void> {
  if (config || loading) return loading ?? Promise.resolve();
  loading = getStorePurchaseConfig()
    .then((c) => {
      config = c;
      emit();
    })
    .catch(() => {
      // Leave config null: the shop stays hidden, retry on next mount.
    })
    .finally(() => {
      loading = null;
      settled = true;
      emit();
    });
  return loading;
}

/** Test-only reset. */
export function _resetStorePurchaseConfigForTests(next: StorePurchaseConfig | null = null) {
  config = next;
  loading = null;
  settled = next !== null;
  emit();
}

function isStoreBuild(): boolean {
  return isSteamBuild() || isAndroidApp() || isMsStoreBuild() || getStoreKitRail() !== null;
}

export function getStorePurchaseChannel(): StorePurchaseChannel {
  if (isSteamBuild()) {
    if (!hasSteamPurchaseBridge()) return "none";
    if (!config) return settled ? "none" : "loading";
    return config.steam.enabled ? "steam" : "none";
  }
  if (isMsStoreBuild()) {
    if (!hasMsStorePurchaseBridge()) return "none";
    if (!config) return settled ? "none" : "loading";
    return config.msstore?.enabled ? "msstore" : "none";
  }
  if (isAndroidApp()) {
    // Google Play payments policy: the Android app sells digital items
    // through Play Billing only, never Stripe. The shop appears once the
    // app ships the billing plugin and the server turns the storefront on.
    if (!hasGooglePlayBillingBridge()) return "none";
    if (!config) return settled ? "none" : "loading";
    return config.googlePlay?.enabled ? "google_play" : "none";
  }
  if (getStoreKitRail() !== null) {
    // Apple guideline 3.1.1: the iOS app and the Mac App Store build sell
    // through In-App Purchase only. The shop appears once the build ships
    // the StoreKit bridge and the server can verify App Store purchases.
    if (!hasAppStorePurchaseBridge()) return "none";
    if (!config) return settled ? "none" : "loading";
    return config.appStore?.enabled ? "app_store" : "none";
  }
  // Any other store channel forbids Stripe and has no native flow.
  if (isAppStoreChannel()) return "none";
  return "stripe";
}

/** Channels where the shop can take a purchase right now. */
export function canPurchaseIn(channel: StorePurchaseChannel): boolean {
  return (
    channel === "stripe" ||
    channel === "steam" ||
    channel === "google_play" ||
    channel === "msstore" ||
    channel === "app_store"
  );
}

/** Channels that can sell subscriptions (Steam MicroTxn sells one-time items only). */
export function canSubscribeIn(channel: StorePurchaseChannel): boolean {
  return channel === "stripe" || channel === "google_play" || channel === "app_store";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Hydration-safe channel for render paths. Kicks off the config fetch in
 * store builds; web and direct builds never call the endpoint.
 */
export function useStorePurchaseChannel(): StorePurchaseChannel {
  useEffect(() => {
    if (isStoreBuild()) void loadStorePurchaseConfig();
  }, []);
  // The mobile static export pre-renders as "loading" so its HTML never
  // carries a Stripe shop link into the Android app.
  return useSyncExternalStore(subscribe, getStorePurchaseChannel, () =>
    process.env.NEXT_PUBLIC_PLATFORM === "mobile" ? "loading" : "stripe",
  );
}

export class StorePurchaseCancelled extends Error {
  constructor() {
    super("Purchase cancelled");
    this.name = "StorePurchaseCancelled";
  }
}

export class StoreUnavailableError extends Error {
  constructor(
    readonly reason:
      | "steam_not_running"
      | "google_play_unavailable"
      | "msstore_unavailable"
      | "app_store_unavailable",
  ) {
    super(reason);
    this.name = "StoreUnavailableError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Full Steam purchase: ticket → server InitTxn → overlay approval →
 * server FinalizeTxn + grant. Throws StorePurchaseCancelled when the
 * player cancels in the overlay, ApiError for server refusals.
 */
export async function purchaseWithSteam(
  item: { type: string; id: string },
  language: string,
): Promise<StorePurchaseResult> {
  const ticket = await getSteamWebApiTicket();
  if (!ticket) throw new StoreUnavailableError("steam_not_running");

  const { orderId } = await startSteamPurchase({
    itemType: item.type,
    itemId: item.id,
    ticket,
    language,
  });

  const authorized = await waitForSteamMicroTxnAuthorization(orderId);
  if (!authorized) {
    // Let the server close the order if Steam already marked it failed.
    void finalizeSteamPurchase(orderId).catch(() => {});
    throw new StorePurchaseCancelled();
  }

  // Steam flips the order to Approved as the callback fires; allow a
  // short window for the status to propagate before giving up. A late
  // approval is still settled by the reconcile call on the next shop visit.
  let result = await finalizeSteamPurchase(orderId);
  for (let attempt = 0; result.status === "pending" && attempt < 5; attempt++) {
    await sleep(1000);
    result = await finalizeSteamPurchase(orderId);
  }
  return result;
}

function toStoreResult(
  item: { type: string; id: string },
  outcome: GooglePlayVerifyResult,
): StorePurchaseResult {
  const itemType = item.type as StorePurchaseResult["itemType"];
  if (outcome.status === "granted" || outcome.status === "pending") {
    return { status: outcome.status, itemType, itemId: item.id };
  }
  return {
    status: "failed",
    itemType,
    itemId: item.id,
    reason: outcome.status === "not_entitled" ? outcome.state : outcome.status,
  };
}

async function verifyWithRetry(productId: string, purchaseToken: string) {
  // The player has paid at this point. A network blip must not lose the
  // grant: retry a few times, and the RTDN push plus the restore on the
  // next shop visit settle anything that still slips through.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await verifyGooglePlayPurchase({ productId, purchaseToken });
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      if (status !== undefined && status < 500) throw error;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * Report every purchase Play lists for the device to the server, which
 * verifies, grants and acknowledges each. Safe to call on every shop visit.
 */
export async function restoreFromGooglePlay(): Promise<{ granted: number }> {
  const purchases = await listGooglePlayPurchases();
  if (purchases.length === 0) return { granted: 0 };
  const { results } = await restoreGooglePlayPurchases(purchases);
  return { granted: results.filter((r) => r.status === "granted").length };
}

/**
 * Full Google Play purchase: Play sheet → server verify + grant + ack.
 * Throws StorePurchaseCancelled when the player backs out of the sheet.
 */
export async function purchaseWithGooglePlay(item: {
  type: string;
  id: string;
}): Promise<StorePurchaseResult> {
  const play = await getGooglePlayConfig();
  const product = play.products.find((p) => p.itemType === item.type && p.itemId === item.id);
  if (!play.enabled || !play.obfuscatedAccountId || !product) {
    throw new StoreUnavailableError("google_play_unavailable");
  }

  let purchaseToken: string;
  try {
    ({ purchaseToken } = await launchGooglePlayPurchase({
      productId: product.productId,
      productType: product.productType,
      basePlanId: product.basePlanId,
      obfuscatedAccountId: play.obfuscatedAccountId,
    }));
  } catch (error) {
    if (!(error instanceof GooglePlayPurchaseError)) throw error;
    if (error.reason === "cancelled") throw new StorePurchaseCancelled();
    if (error.reason === "pending")
      return {
        status: "pending",
        itemType: item.type as StorePurchaseResult["itemType"],
        itemId: item.id,
      };
    if (error.reason === "already_owned") {
      // Paid earlier but never granted here (e.g. crash before verify).
      const { granted } = await restoreFromGooglePlay();
      return {
        status: granted > 0 ? "granted" : "failed",
        itemType: item.type as StorePurchaseResult["itemType"],
        itemId: item.id,
        ...(granted > 0 ? {} : { reason: "already_owned" }),
      };
    }
    if (error.reason === "unavailable") throw new StoreUnavailableError("google_play_unavailable");
    throw error;
  }

  return toStoreResult(item, await verifyWithRetry(product.productId, purchaseToken));
}

/**
 * Ask the API server what the signed-in Microsoft Store user owns and
 * grant it to this account. Used after a purchase and as "restore
 * purchases" when the shop opens. Returns null when the Store key could
 * not be minted (no Store account signed in, offline).
 */
export async function syncMsStore(): Promise<MsStoreSyncResult | null> {
  const { serviceTicket, publisherUserId } = await getMsStoreTicket();
  const key = await getMsStoreCollectionsId(serviceTicket, publisherUserId);
  if (!key) return null;
  return syncMsStorePurchases(key);
}

/**
 * Full Microsoft Store purchase: Store dialog for the add-on, then a
 * server-side ownership check that grants the item. The server, not the
 * dialog result, decides whether the item is granted.
 */
export async function purchaseWithMsStore(item: {
  type: string;
  id: string;
  msStoreOfferToken?: string;
}): Promise<StorePurchaseResult> {
  const base = { itemType: item.type as "badge" | "theme", itemId: item.id };
  if (!item.msStoreOfferToken) throw new StoreUnavailableError("msstore_unavailable");

  const status = await requestMsStorePurchase(item.msStoreOfferToken);
  if (status === "notPurchased") throw new StorePurchaseCancelled();
  if (status === "unavailable" || status === "unknownProduct") {
    throw new StoreUnavailableError("msstore_unavailable");
  }
  if (status !== "succeeded" && status !== "alreadyPurchased") {
    return { status: "failed", reason: status, ...base };
  }

  const sync = await syncMsStore();
  if (!sync) return { status: "pending", ...base };
  const mine = [...sync.granted, ...sync.restored].some(
    (g) => g.itemType === item.type && g.itemId === item.id,
  );
  if (mine) return { status: "granted", ...base };
  if (sync.claimedElsewhere.some((g) => g.itemType === item.type && g.itemId === item.id)) {
    return { status: "failed", reason: "claimed_elsewhere", ...base };
  }
  // Microsoft's collections can lag the purchase by a few seconds.
  return { status: "pending", ...base };
}

// ---------------------------------------------------------------------------
// App Store (iOS app + Mac App Store build)
// ---------------------------------------------------------------------------

function fromAppStoreResult(purchase: AppStorePurchaseResult): StorePurchaseResult {
  return {
    status: purchase.entitled ? "granted" : "failed",
    itemType: purchase.itemType,
    itemId: purchase.itemId,
    ...(purchase.entitled ? {} : { reason: purchase.status }),
  };
}

async function verifyAppStoreWithRetry(proof: StoreProof) {
  // Paid already: retry server hiccups. If it still fails, the StoreKit
  // transaction stays unfinished (Mac) or in currentEntitlements (iOS),
  // and the next shop visit claims it.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (await verifyAppStorePurchase(proof)).purchase;
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      if (status !== undefined && status < 500) throw error;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * Full App Store purchase: StoreKit payment sheet → server verifies the
 * signed transaction (or looks up the Mac App Store transaction id) and
 * grants → StoreKit transaction finished. Throws StorePurchaseCancelled
 * when the player dismisses the sheet.
 */
export async function purchaseWithAppStore(item: {
  type: string;
  id: string;
  appStoreProductId?: string;
}): Promise<StorePurchaseResult> {
  const base = { itemType: item.type as StorePurchaseResult["itemType"], itemId: item.id };
  const adapter = await getStoreKitAdapter();
  if (!adapter || !item.appStoreProductId) throw new StoreUnavailableError("app_store_unavailable");

  const { appAccountToken } = await prepareAppStorePurchase();
  let proof: StoreProof | null;
  try {
    proof = await adapter.purchase(item.appStoreProductId, appAccountToken);
  } catch (error) {
    // Ask to Buy: the approval arrives later through watchAppStorePurchases.
    if (error instanceof StoreKitPendingError) return { status: "pending", ...base };
    throw error;
  }
  if (!proof) throw new StorePurchaseCancelled();

  let purchase: AppStorePurchaseResult;
  try {
    purchase = await verifyAppStoreWithRetry(proof);
  } catch (error) {
    if (error instanceof ApiError && error.code === "PURCHASE_CLAIMED_BY_OTHER_ACCOUNT") {
      await adapter.finish(proof);
      return { status: "failed", reason: "claimed_elsewhere", ...base };
    }
    throw error;
  }
  await adapter.finish(proof);
  return fromAppStoreResult(purchase);
}

/**
 * "Restore Purchases" (Apple requires the button for non-consumables):
 * StoreKit lists what the Apple ID owns, the server verifies and grants
 * each item to this account.
 */
export async function restoreFromAppStore(): Promise<{ granted: number }> {
  const adapter = await getStoreKitAdapter();
  if (!adapter) throw new StoreUnavailableError("app_store_unavailable");
  const proofs = await adapter.restore();
  if (proofs.length === 0) return { granted: 0 };
  const { purchases } = await restoreAppStorePurchases(proofs);
  await Promise.all(proofs.map((proof) => adapter.finish(proof).catch(() => {})));
  return { granted: purchases.filter((p) => p.entitled).length };
}

/**
 * Silent counterpart of restoreFromAppStore for shop visits: claims what
 * StoreKit already has on the device (a purchase whose verify call never
 * reached the server) without the Apple ID prompt a full restore causes.
 */
export async function claimAppStoreEntitlements(): Promise<{ granted: number }> {
  const adapter = await getStoreKitAdapter();
  if (!adapter) return { granted: 0 };
  const proofs = await adapter.currentProofs();
  if (proofs.length === 0) return { granted: 0 };
  const { purchases } = await restoreAppStorePurchases(proofs);
  await Promise.all(proofs.map((proof) => adapter.finish(proof).catch(() => {})));
  return { granted: purchases.filter((p) => p.entitled).length };
}

/** Localized App Store prices keyed by product id. */
export async function getAppStorePrices(productIds: string[]): Promise<Record<string, string>> {
  const adapter = await getStoreKitAdapter();
  if (!adapter || productIds.length === 0) return {};
  try {
    const products = await adapter.getProducts(productIds);
    return Object.fromEntries(
      products.flatMap((p) => (p.priceString ? [[p.productId, p.priceString]] : [])),
    );
  } catch {
    return {};
  }
}

/**
 * Claim purchases that complete outside the buy button: renewals, Ask to
 * Buy approvals, and Mac App Store transactions a crash left unfinished.
 * Returns an unsubscribe function.
 */
export function watchAppStorePurchases(onGranted: () => void): () => void {
  let unsubscribe: (() => void) | null = null;
  let stopped = false;
  void getStoreKitAdapter().then((adapter) => {
    if (!adapter || stopped) return;
    unsubscribe = adapter.onUnclaimedPurchase((proof) => {
      verifyAppStorePurchase(proof)
        .then(async ({ purchase }) => {
          await adapter.finish(proof);
          if (purchase.entitled) onGranted();
        })
        .catch(() => {});
    });
  });
  return () => {
    stopped = true;
    unsubscribe?.();
  };
}
