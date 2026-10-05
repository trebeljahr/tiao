/**
 * Renderer-side wrapper around the Microsoft Store purchase bridge exposed
 * by `desktop/preload.cjs` (`window.electron.msstore`). Functional only in
 * the msstore (AppX) desktop build; see desktop/src/msstore.cjs.
 */

export type MsStoreAddOn = {
  storeId: string;
  inAppOfferToken: string;
  title: string;
  formattedPrice: string;
  isInUserCollection: boolean;
};

export type MsStorePurchaseStatus =
  | "succeeded"
  | "alreadyPurchased"
  | "notPurchased"
  | "networkError"
  | "serverError"
  | "unavailable"
  | "unknownProduct";

type MsStoreBridge = {
  isAvailable: () => Promise<boolean>;
  getAddOns: () => Promise<MsStoreAddOn[]>;
  purchase: (
    offerToken: string,
  ) => Promise<{ status: MsStorePurchaseStatus; extendedError?: string }>;
  getCollectionsId: (serviceTicket: string, publisherUserId: string) => Promise<string | null>;
};

type ElectronWindow = {
  electron?: { config?: { distributionChannel?: string }; msstore?: MsStoreBridge };
};

function getBridge(): MsStoreBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as ElectronWindow).electron?.msstore ?? null;
}

/** True in the desktop build packaged for the Microsoft Store. Synchronous. */
export function isMsStoreBuild(): boolean {
  if (typeof window === "undefined") return false;
  return (window as unknown as ElectronWindow).electron?.config?.distributionChannel === "msstore";
}

/** The preload exposes the purchase bridge (a desktop new enough to sell). */
export function hasMsStorePurchaseBridge(): boolean {
  const bridge = getBridge();
  return typeof bridge?.purchase === "function" && typeof bridge?.getCollectionsId === "function";
}

export async function getMsStoreAddOns(): Promise<MsStoreAddOn[]> {
  const bridge = getBridge();
  if (!bridge) return [];
  try {
    return await bridge.getAddOns();
  } catch {
    return [];
  }
}

export async function requestMsStorePurchase(offerToken: string): Promise<MsStorePurchaseStatus> {
  const bridge = getBridge();
  if (!bridge) return "unavailable";
  try {
    return (await bridge.purchase(offerToken)).status;
  } catch {
    return "serverError";
  }
}

export async function getMsStoreCollectionsId(
  serviceTicket: string,
  publisherUserId: string,
): Promise<string | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  try {
    return await bridge.getCollectionsId(serviceTicket, publisherUserId);
  } catch {
    return null;
  }
}
