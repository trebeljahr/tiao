/**
 * Renderer-side wrapper around Google Play Billing in the Android app.
 *
 * The billing client is the `@capgo/native-purchases` Capacitor plugin,
 * installed in `mobile/` and reached through the Capacitor bridge the
 * WebView injects (`window.Capacitor`). The client bundle does not import
 * the plugin package: web and desktop builds never load it, and every
 * function here returns a safe default when the bridge or plugin is absent.
 *
 * Purchases are never acknowledged on the device. The server verifies each
 * token with the Play Developer API, grants the item, then acknowledges —
 * see server/payments/googlePlayFulfillment.ts. For that reason this file
 * must not call the plugin's `restorePurchases()`: on Android it
 * acknowledges every unacknowledged purchase client-side.
 */

export type PlayProductType = "inapp" | "subs";

export type PlayTransaction = {
  productIdentifier?: string;
  purchaseToken?: string;
  /** Play's Purchase.PurchaseState as a string: "1" purchased, "2" pending. */
  purchaseState?: string;
  isAcknowledged?: boolean;
  orderId?: string;
};

export type PlayProduct = {
  identifier: string;
  priceString: string;
  planIdentifier?: string;
};

type NativePurchasesPlugin = {
  isBillingSupported(): Promise<{ isBillingSupported: boolean }>;
  getProducts(options: {
    productIdentifiers: string[];
    productType?: PlayProductType;
  }): Promise<{ products: PlayProduct[] }>;
  purchaseProduct(options: {
    productIdentifier: string;
    planIdentifier?: string;
    productType?: PlayProductType;
    quantity?: number;
    appAccountToken?: string;
    isConsumable?: boolean;
    autoAcknowledgePurchases?: boolean;
  }): Promise<PlayTransaction>;
  getPurchases(options?: { productType?: PlayProductType }): Promise<{
    purchases: PlayTransaction[];
  }>;
  manageSubscriptions(): Promise<void>;
};

type CapacitorWindow = {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    isPluginAvailable?: (name: string) => boolean;
    Plugins?: Record<string, unknown>;
  };
};

const PLUGIN_NAME = "NativePurchases";

/** True inside the Capacitor Android app (never in a browser or Electron). */
export function isAndroidApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as CapacitorWindow).Capacitor;
  if (!cap || typeof cap.getPlatform !== "function") return false;
  if (typeof cap.isNativePlatform === "function" && !cap.isNativePlatform()) return false;
  return cap.getPlatform() === "android";
}

function getPlugin(): NativePurchasesPlugin | null {
  if (!isAndroidApp()) return null;
  const cap = (window as unknown as CapacitorWindow).Capacitor;
  if (typeof cap?.isPluginAvailable === "function" && !cap.isPluginAvailable(PLUGIN_NAME)) {
    return null;
  }
  return (cap?.Plugins?.[PLUGIN_NAME] as NativePurchasesPlugin | undefined) ?? null;
}

/** The Android app was built with the billing plugin. Synchronous, for render paths. */
export function hasGooglePlayBillingBridge(): boolean {
  return getPlugin() !== null;
}

export async function isGooglePlayBillingSupported(): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    return (await plugin.isBillingSupported()).isBillingSupported;
  } catch {
    return false;
  }
}

/** Localized Play prices keyed by product id. Missing entries fall back to catalog prices. */
export async function getGooglePlayPrices(
  products: { productId: string; productType: PlayProductType }[],
): Promise<Record<string, string>> {
  const plugin = getPlugin();
  if (!plugin) return {};
  const prices: Record<string, string> = {};
  for (const productType of ["inapp", "subs"] as const) {
    const ids = products.filter((p) => p.productType === productType).map((p) => p.productId);
    if (ids.length === 0) continue;
    try {
      const { products: found } = await plugin.getProducts({
        productIdentifiers: ids,
        productType,
      });
      for (const p of found) {
        // Subscriptions come back as `planIdentifier` = product id.
        const id = productType === "subs" ? (p.planIdentifier ?? p.identifier) : p.identifier;
        if (p.priceString && !prices[id]) prices[id] = p.priceString;
      }
    } catch {
      // Products not yet live in the Play Console: keep catalog prices.
    }
  }
  return prices;
}

export class GooglePlayPurchaseError extends Error {
  constructor(
    readonly reason: "cancelled" | "already_owned" | "pending" | "unavailable" | "failed",
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "GooglePlayPurchaseError";
  }
}

/** Launch the Play purchase sheet. Resolves with the purchased transaction. */
export async function launchGooglePlayPurchase(options: {
  productId: string;
  productType: PlayProductType;
  basePlanId?: string | null;
  obfuscatedAccountId: string;
}): Promise<PlayTransaction & { purchaseToken: string }> {
  const plugin = getPlugin();
  if (!plugin) throw new GooglePlayPurchaseError("unavailable");
  let transaction: PlayTransaction;
  try {
    transaction = await plugin.purchaseProduct({
      productIdentifier: options.productId,
      productType: options.productType,
      ...(options.basePlanId ? { planIdentifier: options.basePlanId } : {}),
      quantity: 1,
      appAccountToken: options.obfuscatedAccountId,
      isConsumable: false,
      autoAcknowledgePurchases: false,
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const message = (error as { message?: string })?.message ?? "";
    if (code === "USER_CANCELED") throw new GooglePlayPurchaseError("cancelled");
    if (code === "ITEM_ALREADY_OWNED") throw new GooglePlayPurchaseError("already_owned");
    if (/pending/i.test(message)) throw new GooglePlayPurchaseError("pending");
    if (code === "BILLING_UNAVAILABLE" || code === "SERVICE_UNAVAILABLE") {
      throw new GooglePlayPurchaseError("unavailable", message);
    }
    throw new GooglePlayPurchaseError("failed", message || code);
  }
  if (!transaction.purchaseToken) throw new GooglePlayPurchaseError("failed", "no purchase token");
  return transaction as PlayTransaction & { purchaseToken: string };
}

/** Every purchase Play still lists for this device's Google account. */
export async function listGooglePlayPurchases(): Promise<
  { productId: string; purchaseToken: string }[]
> {
  const plugin = getPlugin();
  if (!plugin) return [];
  const all: { productId: string; purchaseToken: string }[] = [];
  for (const productType of ["inapp", "subs"] as const) {
    const { purchases } = await plugin.getPurchases({ productType });
    for (const p of purchases) {
      if (p.productIdentifier && p.purchaseToken) {
        all.push({ productId: p.productIdentifier, purchaseToken: p.purchaseToken });
      }
    }
  }
  return all;
}

export async function openGooglePlaySubscriptions(): Promise<void> {
  await getPlugin()?.manageSubscriptions();
}
