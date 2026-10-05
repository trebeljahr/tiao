import express, { type Request, type Response } from "express";
import { getAppStoreGateway } from "../appStore/appStoreGateway";
import { getPlayerFromRequest } from "../auth/sessionHelper";
import type { ShopItem } from "../config/shopCatalog";
import { handleRouteError } from "../error-handling/routeError";
import GameAccount from "../models/GameAccount";
import { isGooglePlayStorefrontEnabled } from "../payments/googlePlayApi";
import { msStoreCollectionsFromEnv } from "../payments/msStoreCollections";
import { steamMicroTxnFromEnv } from "../payments/steamMicroTxn";
import {
  createStorePurchaseService,
  defaultGranter,
  mongoStorePurchaseLedger,
  StorePurchaseError,
  type StorePurchaseService,
} from "../payments/storePurchases";

/**
 * In-app purchases through platform stores, mounted at /shop/iap.
 *
 *   GET  /config            which store providers this server can fulfill
 *   POST /steam/init        { itemType, itemId, ticket, language } → { orderId }
 *   POST /steam/finalize    { orderId } → { status, itemType, itemId }
 *   POST /steam/reconcile   settle this player's pending Steam orders
 *   POST /msstore/ticket    → { serviceTicket, publisherUserId } for GetCustomerCollectionsIdAsync
 *   POST /msstore/sync      { storeIdKey } → { granted, restored, claimedElsewhere }
 *
 * Google Play Billing is mounted beside it at /shop/iap/google-play, the
 * App Store (iOS + Mac App Store) at /shop/iap/app-store.
 *
 * Kept apart from shop.routes.ts (Stripe) so the Steam and Microsoft Store
 * builds never touch the Stripe code path, which their store rules forbid.
 */
const router = express.Router();

async function isOwned(playerId: string, item: ShopItem): Promise<boolean> {
  const account = await GameAccount.findById(playerId);
  if (!account) return false;
  return item.type === "badge"
    ? (account.badges ?? []).includes(item.id)
    : (account.unlockedThemes ?? []).includes(item.id);
}

let service: StorePurchaseService | null = null;
let steamEnabled = false;
let steamSandbox = false;
let msStoreEnabled = false;

function getService(): StorePurchaseService {
  if (!service) {
    const steam = steamMicroTxnFromEnv();
    steamEnabled = steam !== null;
    steamSandbox = steam?.sandbox ?? false;
    const msStore = msStoreCollectionsFromEnv();
    msStoreEnabled = msStore !== null;
    service = createStorePurchaseService({
      msStore,
      ledger: mongoStorePurchaseLedger,
      grant: defaultGranter,
      isOwned,
      steam,
    });
  }
  return service;
}

/** Test seam: swap in a service built with fakes. Pass null to reset. */
export function setStorePurchaseServiceForTests(
  next: StorePurchaseService | null,
  flags: { steam?: boolean; steamSandbox?: boolean; msStore?: boolean } = {},
): void {
  service = next;
  msStoreEnabled = flags.msStore ?? false;
  steamEnabled = flags.steam ?? false;
  steamSandbox = flags.steamSandbox ?? false;
}

async function requireAccount(req: Request, res: Response): Promise<string | null> {
  const player = await getPlayerFromRequest(req);
  if (!player || player.kind !== "account") {
    res.status(401).json({
      code: "ACCOUNT_REQUIRED",
      message: "You must be signed in to make a purchase.",
    });
    return null;
  }
  return player.playerId;
}

function sendError(req: Request, res: Response, error: unknown, fallback: string) {
  if (error instanceof StorePurchaseError) {
    return res.status(error.status).json({ code: error.code, message: error.message });
  }
  return handleRouteError(res, error, fallback, req);
}

router.get("/config", (_req: Request, res: Response) => {
  getService();
  return res.json({
    steam: { enabled: steamEnabled, sandbox: steamSandbox },
    // Play billing itself lives in googlePlay.routes.ts (/shop/iap/google-play).
    googlePlay: { enabled: isGooglePlayStorefrontEnabled() },
    msstore: { enabled: msStoreEnabled },
    // App Store (iOS + Mac App Store) lives in appStore.routes.ts (/shop/iap/app-store).
    appStore: { enabled: getAppStoreGateway() !== null },
  });
});

router.post("/steam/init", async (req: Request, res: Response) => {
  try {
    const playerId = await requireAccount(req, res);
    if (!playerId) return;
    const { itemType, itemId, ticket, language } = req.body ?? {};
    const out = await getService().startSteamPurchase({
      playerId,
      itemType,
      itemId,
      ticket,
      language,
    });
    return res.json(out);
  } catch (error) {
    return sendError(req, res, error, "Unable to start Steam purchase.");
  }
});

router.post("/steam/finalize", async (req: Request, res: Response) => {
  try {
    const playerId = await requireAccount(req, res);
    if (!playerId) return;
    const out = await getService().finalizeSteamPurchase({ playerId, orderId: req.body?.orderId });
    return res.json(out);
  } catch (error) {
    return sendError(req, res, error, "Unable to finalize Steam purchase.");
  }
});

router.post("/steam/reconcile", async (req: Request, res: Response) => {
  try {
    const playerId = await requireAccount(req, res);
    if (!playerId) return;
    const results = await getService().reconcileSteamPurchases(playerId);
    return res.json({ results });
  } catch (error) {
    return sendError(req, res, error, "Unable to reconcile Steam purchases.");
  }
});

router.post("/msstore/ticket", async (req: Request, res: Response) => {
  try {
    const playerId = await requireAccount(req, res);
    if (!playerId) return;
    return res.json(await getService().issueMsStoreTicket(playerId));
  } catch (error) {
    return sendError(req, res, error, "Unable to start Microsoft Store verification.");
  }
});

router.post("/msstore/sync", async (req: Request, res: Response) => {
  try {
    const playerId = await requireAccount(req, res);
    if (!playerId) return;
    const out = await getService().syncMsStorePurchases({
      playerId,
      storeIdKey: req.body?.storeIdKey,
    });
    return res.json(out);
  } catch (error) {
    return sendError(req, res, error, "Unable to verify Microsoft Store purchases.");
  }
});

export default router;
