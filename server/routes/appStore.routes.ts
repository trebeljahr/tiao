import express, { type Request, type Response } from "express";
import {
  type AppStoreEntitlementResult,
  claimAppStorePurchase,
  ensureAppStoreAccountToken,
  processAppStoreNotification,
} from "../appStore/appStoreEntitlements";
import {
  type AppStoreGateway,
  AppStoreGatewayError,
  getAppStoreGateway,
} from "../appStore/appStoreGateway";
import { getPlayerFromRequest } from "../auth/sessionHelper";
import { handleRouteError } from "../error-handling/routeError";

/**
 * In-App Purchase endpoints for the iOS app and the Mac App Store build
 * (mounted at /shop/iap/app-store). Stripe stays the payment path everywhere
 * else; both grant the same badges and themes.
 *
 *   POST /prepare        appAccountToken for StoreKit, before a purchase
 *   POST /verify         claim one purchase (JWS or transaction id)
 *   POST /restore        claim every purchase StoreKit reports
 *   POST /notifications  App Store Server Notifications v2 (Apple calls this)
 */
const router = express.Router();

const MAX_RESTORE_PROOFS = 50;

function notConfigured(res: Response) {
  return res.status(503).json({
    code: "APP_STORE_NOT_CONFIGURED",
    message: "App Store purchases are not configured on this server.",
  });
}

async function requireAccount(req: Request, res: Response) {
  const player = await getPlayerFromRequest(req);
  if (!player || player.kind !== "account") {
    res.status(401).json({
      code: "ACCOUNT_REQUIRED",
      message: "You must be signed in to make a purchase.",
    });
    return null;
  }
  return player;
}

function sendClaimError(res: Response, error: unknown, req: Request) {
  if (error instanceof AppStoreGatewayError) {
    return res.status(error.status).json({ code: error.code, message: error.message });
  }
  return handleRouteError(res, error, "Unable to verify App Store purchase.", req);
}

router.post("/prepare", async (req: Request, res: Response) => {
  try {
    if (!getAppStoreGateway()) return notConfigured(res);
    const player = await requireAccount(req, res);
    if (!player) return;
    const appAccountToken = await ensureAppStoreAccountToken(player.playerId);
    return res.json({ appAccountToken });
  } catch (error) {
    return handleRouteError(res, error, "Unable to prepare App Store purchase.", req);
  }
});

router.post("/verify", async (req: Request, res: Response) => {
  const gateway = getAppStoreGateway();
  if (!gateway) return notConfigured(res);
  try {
    const player = await requireAccount(req, res);
    if (!player) return;
    const { signedTransaction, transactionId } = req.body ?? {};
    const result = await claimAppStorePurchase(gateway, player.playerId, {
      signedTransaction,
      transactionId,
    });
    return res.json({ purchase: result });
  } catch (error) {
    return sendClaimError(res, error, req);
  }
});

router.post("/restore", async (req: Request, res: Response) => {
  const gateway = getAppStoreGateway();
  if (!gateway) return notConfigured(res);
  try {
    const player = await requireAccount(req, res);
    if (!player) return;
    const body = req.body ?? {};
    const proofs = [
      ...(Array.isArray(body.signedTransactions) ? body.signedTransactions : []).map(
        (signedTransaction: unknown) => ({ signedTransaction }),
      ),
      ...(Array.isArray(body.transactionIds) ? body.transactionIds : []).map(
        (transactionId: unknown) => ({ transactionId }),
      ),
    ];
    if (proofs.length > MAX_RESTORE_PROOFS) {
      return res.status(400).json({
        code: "TOO_MANY_PROOFS",
        message: `Send at most ${MAX_RESTORE_PROOFS} transactions per restore.`,
      });
    }

    const purchases: AppStoreEntitlementResult[] = [];
    const errors: { index: number; code: string }[] = [];
    // Sequential: proofs for one subscription chain must not race.
    for (const [index, proof] of proofs.entries()) {
      try {
        purchases.push(await claimAppStorePurchase(gateway, player.playerId, proof));
      } catch (error) {
        if (!(error instanceof AppStoreGatewayError)) throw error;
        errors.push({ index, code: error.code });
      }
    }
    return res.json({ purchases, errors });
  } catch (error) {
    return sendClaimError(res, error, req);
  }
});

export async function handleAppStoreNotification(
  gateway: AppStoreGateway,
  signedPayload: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (typeof signedPayload !== "string" || !signedPayload) {
    return { status: 400, body: { message: "Missing signedPayload." } };
  }
  let notification;
  try {
    notification = await gateway.verifyNotification(signedPayload);
  } catch (error) {
    console.warn("[appStore] Notification failed verification:", error);
    return { status: 400, body: { message: "Invalid signedPayload." } };
  }
  const outcome = await processAppStoreNotification(gateway, notification);
  return { status: 200, body: { received: true, handled: outcome.handled } };
}

router.post("/notifications", async (req: Request, res: Response) => {
  const gateway = getAppStoreGateway();
  if (!gateway) return notConfigured(res);
  try {
    const { status, body } = await handleAppStoreNotification(gateway, req.body?.signedPayload);
    return res.status(status).json(body);
  } catch (error) {
    // Non-200 makes Apple retry with backoff (up to five times over ~3 days).
    console.error("[appStore] Notification processing failed:", error);
    return res.status(500).json({ message: "Notification processing failed." });
  }
});

export default router;
