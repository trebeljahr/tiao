import express, { type Request, type Response } from "express";
import { getPlayerFromRequest } from "../auth/sessionHelper";
import { FRONTEND_URL } from "../config/envVars";
import { appStoreProductId, findShopItem, SHOP_ITEMS } from "../config/shopCatalog";
import { handleRouteError } from "../error-handling/routeError";
import GameAccount, { type ISubscription } from "../models/GameAccount";

import { mongoStripeShop } from "../payments/mongoStripeShop";
import { StripeShop } from "../payments/stripeShop";

const router = express.Router();

function getStripe(): any {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // Public production checkout must never charge in a sandbox or run
  // without the webhook secret needed to fulfill purchases.
  if (
    process.env.NODE_ENV === "production" &&
    (!/^(sk|rk)_live_/.test(key) || !process.env.STRIPE_WEBHOOK_SECRET)
  ) {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Stripe = require("stripe");
  return new Stripe(key);
}

function shop(stripe: any) {
  return new StripeShop(stripe, mongoStripeShop, FRONTEND_URL || "http://127.0.0.1:3000");
}

// ---------------------------------------------------------------------------
// GET /catalog — public, returns all shop items + ownership for logged-in user
// ---------------------------------------------------------------------------

router.get("/catalog", async (req: Request, res: Response) => {
  try {
    const player = await getPlayerFromRequest(req);
    let ownedBadges: string[] = [];
    let ownedThemes: string[] = [];

    if (player && player.kind === "account") {
      const account = await GameAccount.findById(player.playerId);
      if (account) {
        ownedBadges = account.badges ?? [];
        ownedThemes = account.unlockedThemes ?? [];
      }
    }

    const catalog = SHOP_ITEMS.map((item) => ({
      ...item,
      appStoreProductId: appStoreProductId(item),
      owned: item.type === "badge" ? ownedBadges.includes(item.id) : ownedThemes.includes(item.id),
    }));

    return res.json({ catalog });
  } catch (error) {
    return handleRouteError(res, error, "Unable to load shop catalog.", req);
  }
});

// ---------------------------------------------------------------------------
// POST /checkout — creates a Stripe Checkout session (requires account)
// ---------------------------------------------------------------------------

router.post("/checkout", async (req: Request, res: Response) => {
  try {
    const player = await getPlayerFromRequest(req);
    if (!player || player.kind !== "account") {
      return res.status(401).json({
        code: "ACCOUNT_REQUIRED",
        message: "You must be signed in to make a purchase.",
      });
    }

    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({
        code: "STRIPE_NOT_CONFIGURED",
        message: "Payments are not configured on this server.",
      });
    }

    const { itemType, itemId } = req.body ?? {};
    if (!itemType || !itemId) {
      return res.status(400).json({
        code: "MISSING_ITEM",
        message: "Specify itemType and itemId.",
      });
    }

    const item = findShopItem(itemType, itemId);
    if (!item) {
      return res.status(404).json({
        code: "ITEM_NOT_FOUND",
        message: "That item does not exist in the shop.",
      });
    }

    const account = await GameAccount.findById(player.playerId);

    // For subscription items, check if already subscribed
    if (item.recurring && account) {
      const existing = account.activeSubscriptions?.find(
        (s: ISubscription) =>
          s.badgeId === item.id &&
          (s.status === "active" ||
            s.status === "past_due" ||
            (s.status === "canceled" && new Date(s.currentPeriodEnd).getTime() > Date.now())),
      );
      if (existing) {
        return res.status(409).json({
          code: "ALREADY_SUBSCRIBED",
          message: "You already have an active subscription for this item.",
        });
      }
    }

    // For one-time items, check if already owned
    if (!item.recurring && account) {
      const alreadyOwned =
        item.type === "badge"
          ? account.badges.includes(item.id)
          : (account.unlockedThemes ?? []).includes(item.id);
      if (alreadyOwned) {
        return res.status(409).json({
          code: "ALREADY_OWNED",
          message: "You already own this item.",
        });
      }
    }

    // Ensure Stripe customer exists for subscription items
    let customerId: string | undefined;
    if (item.recurring && account) {
      if (account.stripeCustomerId) {
        customerId = account.stripeCustomerId;
      } else {
        const customer = await stripe.customers.create(
          {
            metadata: { playerId: player.playerId },
          },
          { idempotencyKey: `shop-customer:${player.playerId}` },
        );
        account.stripeCustomerId = customer.id;
        await account.save();
        customerId = customer.id;
      }
    }

    if (!account) return res.status(404).json({ message: "Account not found." });
    const result = await shop(stripe).checkout(
      player.playerId,
      item,
      req.body.desktop === true,
      customerId,
    );
    return res.json(result);
  } catch (error) {
    return handleRouteError(res, error, "Unable to create checkout session.", req);
  }
});

// Authenticated reconciliation also repairs a paid purchase if its webhook is delayed.
router.get("/checkout/:sessionId", async (req: Request, res: Response) => {
  try {
    const player = await getPlayerFromRequest(req);
    if (!player || player.kind !== "account")
      return res.status(401).json({ code: "ACCOUNT_REQUIRED" });
    const sessionId = req.params.sessionId;
    if (
      typeof sessionId !== "string" ||
      !/^cs_(?:test_|live_)?[A-Za-z0-9_]{1,240}$/.test(sessionId)
    ) {
      return res.status(400).json({ message: "Invalid checkout session." });
    }
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ code: "STRIPE_NOT_CONFIGURED" });
    const result = await shop(stripe).status(sessionId, player.playerId);
    if (!result) return res.status(404).json({ message: "Checkout not found." });
    return res.json(result);
  } catch (error) {
    return handleRouteError(res, error, "Unable to check purchase.", req);
  }
});

// ---------------------------------------------------------------------------
// GET /subscriptions — returns player's active subscriptions
// ---------------------------------------------------------------------------

router.get("/subscriptions", async (req: Request, res: Response) => {
  try {
    const player = await getPlayerFromRequest(req);
    if (!player || player.kind !== "account") {
      return res.status(401).json({
        code: "ACCOUNT_REQUIRED",
        message: "You must be signed in.",
      });
    }

    const account = await GameAccount.findById(player.playerId);
    const subscriptions = (account?.activeSubscriptions ?? []).map((s: ISubscription) => ({
      subscriptionId: s.subscriptionId,
      provider: s.provider ?? "stripe",
      accessSuspended: s.accessSuspended ?? false,
      badgeId: s.badgeId,
      status: s.status,
      currentPeriodEnd: s.currentPeriodEnd,
    }));

    return res.json({ subscriptions });
  } catch (error) {
    return handleRouteError(res, error, "Unable to load subscriptions.", req);
  }
});

// ---------------------------------------------------------------------------
// POST /cancel-subscription — player cancels their subscription
// ---------------------------------------------------------------------------

router.post("/cancel-subscription", async (req: Request, res: Response) => {
  try {
    const player = await getPlayerFromRequest(req);
    if (!player || player.kind !== "account") {
      return res.status(401).json({
        code: "ACCOUNT_REQUIRED",
        message: "You must be signed in.",
      });
    }

    // App Store subscriptions can only be cancelled by the player in
    // their Apple account settings; Apple then notifies us.
    if (
      typeof req.body?.subscriptionId === "string" &&
      req.body.subscriptionId.startsWith("apple:")
    ) {
      return res.status(409).json({
        code: "MANAGED_BY_APP_STORE",
        message: "Manage this subscription in your Apple account settings.",
      });
    }

    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({
        code: "STRIPE_NOT_CONFIGURED",
        message: "Payments are not configured on this server.",
      });
    }

    const { subscriptionId } = req.body ?? {};
    if (!subscriptionId) {
      return res.status(400).json({
        code: "MISSING_SUBSCRIPTION",
        message: "Specify subscriptionId.",
      });
    }

    const account = await GameAccount.findById(player.playerId);
    const sub = account?.activeSubscriptions?.find(
      (s: ISubscription) => s.subscriptionId === subscriptionId,
    );
    if (!sub) {
      return res.status(404).json({
        code: "SUBSCRIPTION_NOT_FOUND",
        message: "Subscription not found.",
      });
    }

    // Google Play subscriptions can only be cancelled by the player in the
    // Play Store; the RTDN for that cancellation updates the row.
    if (sub.provider === "google_play") {
      return res.status(409).json({
        code: "MANAGED_BY_GOOGLE_PLAY",
        message: "Manage this subscription in the Google Play Store.",
      });
    }

    // Cancel at end of period — badge stays until current_period_end
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    await shop(stripe).syncSubscription(subscriptionId);

    console.info(
      `[shop] Subscription ${subscriptionId} canceled by ${player.playerId}, active until ${sub.currentPeriodEnd}`,
    );

    return res.json({
      message: "Subscription cancelled.",
      currentPeriodEnd: sub.currentPeriodEnd,
    });
  } catch (error) {
    return handleRouteError(res, error, "Unable to cancel subscription.", req);
  }
});

// ---------------------------------------------------------------------------
// POST /webhook — Stripe webhook for fulfillment
// ---------------------------------------------------------------------------

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    try {
      const stripe = getStripe();
      if (!stripe) {
        return res.status(503).json({ message: "Stripe not configured." });
      }

      const sig = req.headers["stripe-signature"];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!sig || !webhookSecret) {
        return res.status(400).json({ message: "Missing signature or webhook secret." });
      }

      let event: any;
      try {
        event = stripe.webhooks.constructEvent(req.body, sig as string, webhookSecret);
      } catch (err) {
        console.warn("[shop] Webhook signature verification failed:", err);
        return res.status(400).json({ message: "Invalid signature." });
      }

      await shop(stripe).webhook(event.type, event.data.object);

      return res.status(200).json({ received: true });
    } catch (error) {
      console.error("[shop] Webhook error:", error);
      return res.status(500).json({ message: "Webhook processing failed." });
    }
  },
);

export default router;
