import express, { type Request, type Response } from "express";
import { getPlayerFromRequest } from "../auth/sessionHelper";
import { SHOP_ITEMS } from "../config/shopCatalog";
import { handleRouteError } from "../error-handling/routeError";
import GameAccount from "../models/GameAccount";
import {
  GooglePlayApiError,
  getGooglePlayApi,
  isGooglePlayStorefrontEnabled,
} from "../payments/googlePlayApi";
import {
  type DeveloperNotification,
  type PlayEntitlementStore,
  PlayFulfillment,
  PlayFulfillmentError,
  playAccountIdFor,
} from "../payments/googlePlayFulfillment";
import { mongoPlayStore } from "../payments/mongoPlayStore";
import { authenticatePush, GoogleCertCache, pushAuthConfigFromEnv } from "../payments/pubsubAuth";

/**
 * Google Play Billing for the Android app. Mounted at /shop/iap/google-play.
 *
 *   GET  /config   product ids + the obfuscated account id the app passes to Play
 *   POST /verify   the app reports one purchase token right after checkout
 *   POST /restore  the app reports every token Play still lists for the device
 *   POST /rtdn     Pub/Sub push of Real-time Developer Notifications
 *
 * All three write paths funnel into PlayFulfillment, which re-reads the
 * purchase from Google before touching entitlements.
 */

const router = express.Router();

let storeOverride: PlayEntitlementStore | null = null;
let certCache = new GoogleCertCache();

/** Tests swap the Mongo store and Google's cert endpoint. */
export function setGooglePlayRouteDepsForTesting(deps: {
  store?: PlayEntitlementStore | null;
  certs?: GoogleCertCache;
}): void {
  if (deps.store !== undefined) storeOverride = deps.store;
  if (deps.certs) certCache = deps.certs;
}

function getFulfillment(): PlayFulfillment | null {
  const api = getGooglePlayApi();
  return api ? new PlayFulfillment(api, storeOverride ?? mongoPlayStore) : null;
}

const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9._]{0,139}$/;
const MAX_TOKEN_LENGTH = 2048;
const MAX_RESTORE = 50;

function parsePurchase(value: unknown): { productId: string; purchaseToken: string } | null {
  if (!value || typeof value !== "object") return null;
  const { productId, purchaseToken } = value as Record<string, unknown>;
  if (typeof productId !== "string" || !PRODUCT_ID_PATTERN.test(productId)) return null;
  if (
    typeof purchaseToken !== "string" ||
    purchaseToken.length === 0 ||
    purchaseToken.length > MAX_TOKEN_LENGTH
  ) {
    return null;
  }
  return { productId, purchaseToken };
}

function notConfigured(res: Response) {
  return res.status(503).json({
    code: "GOOGLE_PLAY_NOT_CONFIGURED",
    message: "Google Play purchases are not configured on this server.",
  });
}

function sendFulfillmentError(res: Response, error: unknown, req: Request) {
  if (error instanceof PlayFulfillmentError) {
    return res.status(error.status).json({ code: error.code, message: error.message });
  }
  if (error instanceof GooglePlayApiError && error.isPermanent) {
    return res.status(400).json({
      code: "INVALID_PURCHASE_TOKEN",
      message: "Google Play does not recognise this purchase.",
    });
  }
  if (error instanceof GooglePlayApiError) {
    console.error("[google-play] API error:", error.message);
    return res.status(502).json({
      code: "GOOGLE_PLAY_UNAVAILABLE",
      message: "Google Play could not be reached. Your purchase is safe — try again shortly.",
    });
  }
  return handleRouteError(res, error, "Unable to verify the purchase.", req);
}

// ---------------------------------------------------------------------------
// GET /config
// ---------------------------------------------------------------------------

router.get("/config", async (req: Request, res: Response) => {
  try {
    const api = getGooglePlayApi();
    const products = SHOP_ITEMS.map((item) => ({
      productId: item.googlePlay.productId,
      basePlanId: item.googlePlay.basePlanId ?? null,
      productType: item.recurring ? "subs" : "inapp",
      itemType: item.type,
      itemId: item.id,
    }));

    let obfuscatedAccountId: string | null = null;
    const player = await getPlayerFromRequest(req);
    if (api && player?.kind === "account") {
      obfuscatedAccountId = playAccountIdFor(player.playerId);
      // Stored so a notification for a purchase the app never reported
      // (crash mid-checkout, pending payment completed later) can still
      // find its account.
      await GameAccount.updateOne(
        { _id: player.playerId, googlePlayAccountId: { $ne: obfuscatedAccountId } },
        { $set: { googlePlayAccountId: obfuscatedAccountId } },
      );
    }

    return res.json({
      enabled: isGooglePlayStorefrontEnabled(),
      packageName: api?.packageName ?? null,
      obfuscatedAccountId,
      products,
    });
  } catch (error) {
    return handleRouteError(res, error, "Unable to load Google Play configuration.", req);
  }
});

// ---------------------------------------------------------------------------
// POST /verify
// ---------------------------------------------------------------------------

router.post("/verify", async (req: Request, res: Response) => {
  try {
    const player = await getPlayerFromRequest(req);
    if (!player || player.kind !== "account") {
      return res.status(401).json({
        code: "ACCOUNT_REQUIRED",
        message: "You must be signed in to make a purchase.",
      });
    }
    const fulfillment = getFulfillment();
    if (!fulfillment) return notConfigured(res);

    const purchase = parsePurchase(req.body);
    if (!purchase) {
      return res.status(400).json({
        code: "INVALID_PURCHASE",
        message: "Specify productId and purchaseToken.",
      });
    }

    const outcome = await fulfillment.verify({ ...purchase, claimantId: player.playerId });
    return res.json(outcome);
  } catch (error) {
    return sendFulfillmentError(res, error, req);
  }
});

// ---------------------------------------------------------------------------
// POST /restore
// ---------------------------------------------------------------------------

router.post("/restore", async (req: Request, res: Response) => {
  try {
    const player = await getPlayerFromRequest(req);
    if (!player || player.kind !== "account") {
      return res.status(401).json({
        code: "ACCOUNT_REQUIRED",
        message: "You must be signed in to restore purchases.",
      });
    }
    const fulfillment = getFulfillment();
    if (!fulfillment) return notConfigured(res);

    const raw = (req.body ?? {}).purchases;
    if (!Array.isArray(raw) || raw.length > MAX_RESTORE) {
      return res.status(400).json({
        code: "INVALID_PURCHASE",
        message: `Send purchases as an array of at most ${MAX_RESTORE}.`,
      });
    }

    const results = [];
    for (const entry of raw) {
      const purchase = parsePurchase(entry);
      if (!purchase) {
        results.push({ status: "error", code: "INVALID_PURCHASE" });
        continue;
      }
      try {
        const outcome = await fulfillment.verify({ ...purchase, claimantId: player.playerId });
        results.push({ productId: purchase.productId, ...outcome });
      } catch (error) {
        // One bad token (another account's, refunded long ago) must not
        // block restoring the rest.
        const code =
          error instanceof PlayFulfillmentError
            ? error.code
            : error instanceof GooglePlayApiError && error.isPermanent
              ? "INVALID_PURCHASE_TOKEN"
              : "GOOGLE_PLAY_UNAVAILABLE";
        if (code === "GOOGLE_PLAY_UNAVAILABLE")
          console.error("[google-play] Restore failed:", error);
        results.push({ productId: purchase.productId, status: "error", code });
      }
    }
    return res.json({ results });
  } catch (error) {
    return handleRouteError(res, error, "Unable to restore purchases.", req);
  }
});

// ---------------------------------------------------------------------------
// POST /rtdn — Pub/Sub push (Real-time Developer Notifications)
// ---------------------------------------------------------------------------

router.post("/rtdn", async (req: Request, res: Response) => {
  try {
    const auth = await authenticatePush(
      { authorization: req.headers.authorization, queryToken: req.query?.token },
      pushAuthConfigFromEnv(),
      certCache,
    );
    if (!auth.ok) {
      console.warn(`[google-play] RTDN rejected: ${auth.reason}`);
      return res.status(auth.status).json({ message: "Unauthorized." });
    }

    const fulfillment = getFulfillment();
    if (!fulfillment) return notConfigured(res);

    const data = (req.body as { message?: { data?: unknown } } | undefined)?.message?.data;
    let notification: DeveloperNotification;
    try {
      notification = JSON.parse(Buffer.from(String(data ?? ""), "base64").toString("utf8"));
    } catch {
      // Malformed payloads never get better on retry — ack and drop.
      console.warn("[google-play] RTDN with undecodable message data");
      return res.status(204).end();
    }

    const { retry } = await fulfillment.handleNotification(notification);
    return retry ? res.status(500).json({ message: "Retry later." }) : res.status(204).end();
  } catch (error) {
    console.error("[google-play] RTDN error:", error);
    return res.status(500).json({ message: "RTDN processing failed." });
  }
});

export default router;
