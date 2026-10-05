/**
 * Which payment path the shop uses in the running client, and the
 * platform-store purchase flows.
 *
 *   - `stripe` — web and direct/itch desktop builds: Stripe Checkout.
 *   - `steam`  — Steam build: Steam Microtransactions through the overlay.
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
  finalizeSteamPurchase,
  getStorePurchaseConfig,
  type StorePurchaseConfig,
  type StorePurchaseResult,
  startSteamPurchase,
} from "./api";
import {
  getSteamWebApiTicket,
  hasSteamPurchaseBridge,
  isSteamBuild,
  waitForSteamMicroTxnAuthorization,
} from "./SteamBridge";

export type StorePurchaseChannel = "stripe" | "steam" | "none" | "loading";

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
  return isSteamBuild();
}

export function getStorePurchaseChannel(): StorePurchaseChannel {
  if (isSteamBuild()) {
    if (!hasSteamPurchaseBridge()) return "none";
    if (!config) return settled ? "none" : "loading";
    return config.steam.enabled ? "steam" : "none";
  }
  return "stripe";
}

/** Channels where the shop can take a purchase right now. */
export function canPurchaseIn(channel: StorePurchaseChannel): boolean {
  return channel === "stripe" || channel === "steam";
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
  return useSyncExternalStore(subscribe, getStorePurchaseChannel, () => "stripe");
}

export class StorePurchaseCancelled extends Error {
  constructor() {
    super("Purchase cancelled");
    this.name = "StorePurchaseCancelled";
  }
}

export class StoreUnavailableError extends Error {
  constructor(readonly reason: "steam_not_running") {
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
