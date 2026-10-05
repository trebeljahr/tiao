/**
 * Renderer-side In-App Purchase adapters for the two Apple storefronts.
 *
 * Apple guideline 3.1.1 requires In-App Purchase for badges, themes and
 * the Patron subscription in the iOS app and the Mac App Store build, so
 * those builds buy through StoreKit instead of Stripe:
 *
 *   - `ios`: Capacitor + @capgo/native-purchases (StoreKit 2). A purchase
 *     yields a signed JWS (`jwsRepresentation`) the server verifies.
 *   - `mas`: Electron's inAppPurchase module (StoreKit 1, bridged in
 *     desktop/src/inAppPurchase.cjs). A purchase yields a transaction id
 *     the server resolves through the App Store Server API.
 *
 * Either way the server is the only party that grants anything; these
 * adapters just carry proof of payment to `POST /api/shop/iap/app-store/verify`.
 *
 * Like GooglePlayBridge, the iOS side reaches the plugin through the
 * Capacitor bridge (`window.Capacitor.Plugins`), so web and desktop
 * bundles never load it. The plugin itself is installed in `mobile/`.
 */

export type StoreKitRail = "ios" | "mas";

export type StoreProduct = {
  productId: string;
  title: string;
  /** Localized price from the App Store, e.g. "2,99 €". */
  priceString: string | null;
};

/** What the server needs to verify one purchase. */
export type StoreProof = { signedTransaction: string } | { transactionId: string };

export interface StoreKitAdapter {
  rail: StoreKitRail;
  getProducts(productIds: string[]): Promise<StoreProduct[]>;
  /**
   * Run the App Store payment sheet. Resolves null when the player
   * cancels; throws on failure or when the purchase awaits approval
   * (Ask to Buy) — `StoreKitPendingError`.
   */
  purchase(productId: string, appAccountToken: string): Promise<StoreProof | null>;
  /**
   * Proofs for everything the Apple account owns. May ask the player to
   * sign in to their Apple ID, so only call it from a button.
   */
  restore(): Promise<StoreProof[]>;
  /**
   * Proofs StoreKit already has on the device, without any prompt: iOS
   * current entitlements, Mac App Store unfinished transactions. Safe to
   * call on every shop visit.
   */
  currentProofs(): Promise<StoreProof[]>;
  /**
   * Purchases that complete outside a `purchase()` call: renewals,
   * Ask to Buy approvals, and Mac App Store transactions left unfinished
   * by a crash. Returns an unsubscribe function.
   */
  onUnclaimedPurchase(cb: (proof: StoreProof) => void): () => void;
  /** Tell the store the server has recorded this purchase. */
  finish(proof: StoreProof): Promise<void>;
}

export class StoreKitPendingError extends Error {
  constructor() {
    super("Purchase is waiting for approval.");
  }
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

type NativePurchasesTransaction = {
  transactionId: string;
  productIdentifier: string;
  jwsRepresentation?: string;
};

type NativePurchasesPlugin = {
  getProducts(options: { productIdentifiers: string[] }): Promise<{
    products: { identifier: string; title: string; priceString: string }[];
  }>;
  purchaseProduct(options: {
    productIdentifier: string;
    quantity?: number;
    appAccountToken?: string;
  }): Promise<NativePurchasesTransaction>;
  restorePurchases(): Promise<void>;
  getPurchases(options?: {
    onlyCurrentEntitlements?: boolean;
  }): Promise<{ purchases: NativePurchasesTransaction[] }>;
  addListener(
    event: "transactionUpdated",
    cb: (transaction: NativePurchasesTransaction) => void,
  ): Promise<{ remove: () => Promise<void> }>;
};

type MasTransaction = {
  transactionId: string;
  productId: string;
  state: "purchased" | "restored" | "failed" | "deferred" | "purchasing";
  errorCode: number | null;
  errorMessage: string | null;
};

type MasBridge = {
  isMasBuild?: boolean;
  isAvailable(): Promise<boolean>;
  getProducts(
    productIds: string[],
  ): Promise<{ productId: string; title: string; formattedPrice: string | null }[]>;
  purchase(
    productId: string,
    appAccountToken: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
  restore(): Promise<void>;
  getPendingTransactions(): Promise<MasTransaction[]>;
  finishTransaction(transactionId: string): Promise<boolean>;
  onTransactions(cb: (transactions: MasTransaction[]) => void): () => void;
};

type StoreKitWindow = {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    isPluginAvailable?: (name: string) => boolean;
    Plugins?: Record<string, unknown>;
  };
  electron?: { iap?: MasBridge };
};

const PLUGIN_NAME = "NativePurchases";

function storeKitWindow(): StoreKitWindow | null {
  return typeof window === "undefined" ? null : (window as unknown as StoreKitWindow);
}

/**
 * Which App Store payment path this build must use, or null for builds
 * that do not sell through Apple. Synchronous so render paths can call it.
 */
export function getStoreKitRail(): StoreKitRail | null {
  const w = storeKitWindow();
  if (!w) return null;
  const cap = w.Capacitor;
  if (
    cap?.getPlatform?.() === "ios" &&
    (typeof cap.isNativePlatform !== "function" || cap.isNativePlatform())
  ) {
    return "ios";
  }
  if (w.electron?.iap?.isMasBuild === true) return "mas";
  return null;
}

// ---------------------------------------------------------------------------
// iOS (StoreKit 2 via @capgo/native-purchases)
// ---------------------------------------------------------------------------

function isUserCancel(error: unknown): boolean {
  const text = `${(error as { code?: unknown })?.code ?? ""} ${(error as Error)?.message ?? error}`;
  return /cancel/i.test(text);
}

function isPending(error: unknown): boolean {
  return /pending|deferred|ask to buy/i.test(String((error as Error)?.message ?? error));
}

function createIosAdapter(plugin: NativePurchasesPlugin): StoreKitAdapter {
  const proofOf = (tx: NativePurchasesTransaction): StoreProof | null =>
    tx.jwsRepresentation ? { signedTransaction: tx.jwsRepresentation } : null;

  return {
    rail: "ios",
    async getProducts(productIds) {
      const { products } = await plugin.getProducts({ productIdentifiers: productIds });
      return products.map((p) => ({
        productId: p.identifier,
        title: p.title,
        priceString: p.priceString || null,
      }));
    },
    async purchase(productId, appAccountToken) {
      let tx: NativePurchasesTransaction;
      try {
        tx = await plugin.purchaseProduct({
          productIdentifier: productId,
          quantity: 1,
          appAccountToken,
        });
      } catch (error) {
        if (isUserCancel(error)) return null;
        if (isPending(error)) throw new StoreKitPendingError();
        throw error;
      }
      const proof = proofOf(tx);
      if (!proof) throw new Error("The App Store returned an unsigned transaction.");
      return proof;
    },
    async restore() {
      // AppStore.sync(): may ask the player to sign in to their Apple ID.
      await plugin.restorePurchases();
      const { purchases } = await plugin.getPurchases({ onlyCurrentEntitlements: true });
      return purchases.map(proofOf).filter((p): p is StoreProof => p !== null);
    },
    async currentProofs() {
      const { purchases } = await plugin.getPurchases({ onlyCurrentEntitlements: true });
      return purchases.map(proofOf).filter((p): p is StoreProof => p !== null);
    },
    onUnclaimedPurchase(cb) {
      let handle: { remove: () => Promise<void> } | null = null;
      let cancelled = false;
      void plugin
        .addListener("transactionUpdated", (tx) => {
          const proof = proofOf(tx);
          if (proof) cb(proof);
        })
        .then((h) => {
          if (cancelled) void h.remove();
          else handle = h;
        });
      return () => {
        cancelled = true;
        void handle?.remove();
      };
    },
    // The plugin finishes StoreKit 2 transactions itself; an unfinished
    // one is still in Transaction.currentEntitlements for restore.
    async finish() {},
  };
}

// ---------------------------------------------------------------------------
// Mac App Store (StoreKit 1 via the Electron preload)
// ---------------------------------------------------------------------------

/** SKErrorPaymentCancelled */
const SK_ERROR_PAYMENT_CANCELLED = 2;
const RESTORE_QUIET_MS = 3000;
const RESTORE_MAX_MS = 30000;

function createMasAdapter(bridge: MasBridge): StoreKitAdapter {
  return {
    rail: "mas",
    async getProducts(productIds) {
      const products = await bridge.getProducts(productIds);
      return products.map((p) => ({
        productId: p.productId,
        title: p.title,
        priceString: p.formattedPrice,
      }));
    },
    purchase(productId, appAccountToken) {
      return new Promise<StoreProof | null>((resolve, reject) => {
        const unsubscribe = bridge.onTransactions((transactions) => {
          const tx = transactions.find((t) => t.productId === productId);
          if (!tx) return;
          if (tx.state === "purchased" || tx.state === "restored") {
            unsubscribe();
            resolve({ transactionId: tx.transactionId });
          } else if (tx.state === "failed") {
            unsubscribe();
            if (tx.errorCode === SK_ERROR_PAYMENT_CANCELLED) resolve(null);
            else reject(new Error(tx.errorMessage || "The purchase failed."));
          } else if (tx.state === "deferred") {
            unsubscribe();
            reject(new StoreKitPendingError());
          }
        });
        bridge.purchase(productId, appAccountToken).then(
          (res) => {
            if (!res.ok) {
              unsubscribe();
              reject(new Error(`Purchase could not start: ${res.reason}`));
            }
          },
          (error) => {
            unsubscribe();
            reject(error);
          },
        );
      });
    },
    restore() {
      // StoreKit 1 replays each owned purchase as a "restored" transaction
      // with no completion signal over the bridge; collect until quiet.
      return new Promise<StoreProof[]>((resolve) => {
        const ids = new Set<string>();
        let quietTimer: ReturnType<typeof setTimeout>;
        const done = () => {
          clearTimeout(quietTimer);
          clearTimeout(maxTimer);
          unsubscribe();
          void bridge.getPendingTransactions().then(
            (pending) => {
              for (const tx of pending) ids.add(tx.transactionId);
              resolve([...ids].map((transactionId) => ({ transactionId })));
            },
            () => resolve([...ids].map((transactionId) => ({ transactionId }))),
          );
        };
        const unsubscribe = bridge.onTransactions((transactions) => {
          for (const tx of transactions) {
            if (tx.state === "restored" || tx.state === "purchased") ids.add(tx.transactionId);
          }
          clearTimeout(quietTimer);
          quietTimer = setTimeout(done, RESTORE_QUIET_MS);
        });
        const maxTimer = setTimeout(done, RESTORE_MAX_MS);
        quietTimer = setTimeout(done, RESTORE_QUIET_MS * 2);
        void bridge.restore();
      });
    },
    async currentProofs() {
      const pending = await bridge.getPendingTransactions();
      return pending.map((tx) => ({ transactionId: tx.transactionId }));
    },
    onUnclaimedPurchase(cb) {
      void bridge.getPendingTransactions().then((pending) => {
        for (const tx of pending) cb({ transactionId: tx.transactionId });
      });
      return bridge.onTransactions((transactions) => {
        for (const tx of transactions) {
          if (tx.state === "purchased" || tx.state === "restored") {
            cb({ transactionId: tx.transactionId });
          }
        }
      });
    },
    async finish(proof) {
      if ("transactionId" in proof) await bridge.finishTransaction(proof.transactionId);
    },
  };
}

// ---------------------------------------------------------------------------

function getIosPlugin(): NativePurchasesPlugin | null {
  const cap = storeKitWindow()?.Capacitor;
  if (typeof cap?.isPluginAvailable === "function" && !cap.isPluginAvailable(PLUGIN_NAME)) {
    return null;
  }
  return (cap?.Plugins?.[PLUGIN_NAME] as NativePurchasesPlugin | undefined) ?? null;
}

/**
 * The build can run App Store purchases: the iOS app shipped with the
 * StoreKit plugin, or a Mac App Store build with the preload bridge.
 * Synchronous, for render paths.
 */
export function hasAppStorePurchaseBridge(): boolean {
  const rail = getStoreKitRail();
  if (rail === "ios") return getIosPlugin() !== null;
  if (rail === "mas") return typeof storeKitWindow()?.electron?.iap?.purchase === "function";
  return false;
}

/**
 * The adapter for this build, or null when it does not sell through
 * Apple or the native bridge is missing.
 */
export async function getStoreKitAdapter(): Promise<StoreKitAdapter | null> {
  const rail = getStoreKitRail();
  if (rail === "ios") {
    const plugin = getIosPlugin();
    return plugin ? createIosAdapter(plugin) : null;
  }
  const bridge = storeKitWindow()?.electron?.iap;
  if (rail !== "mas" || !bridge) return null;
  if (!(await bridge.isAvailable().catch(() => false))) return null;
  return createMasAdapter(bridge);
}

export const _test = { createIosAdapter, createMasAdapter };
