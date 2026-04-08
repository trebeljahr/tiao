import express, { Request, Response } from "express";
import { getPlayerFromRequest } from "../auth/sessionHelper";
import GameAccount, { ISubscription } from "../models/GameAccount";
import { grantBadge, revokeBadge, grantTheme } from "../game/badgeService";
import { handleRouteError } from "../error-handling/routeError";
import { SHOP_ITEMS, findShopItem } from "../config/shopCatalog";
import { FRONTEND_URL } from "../config/envVars";

const router = express.Router();

/**
 * In production the shop is admin-only — used to playtest the Stripe flow
 * with a small allowlist of accounts (flagged isAdmin in the DB) before
 * opening purchases to all players. In development everyone can see it.
 */
function shopAccessAllowed(player: { kind: string; isAdmin?: boolean } | null): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return !!player && player.kind === "account" && player.isAdmin === true;
}

function getStripe(): any {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Stripe = require("stripe");
  return new Stripe(key);
}

/**
 * Pull `current_period_end` from a Stripe Subscription. In API version
 * 2025-08-27.basil this field was removed from the Subscription object and
 * lives on each subscription item instead. Be defensive across both shapes
 * and surface a clear error if neither is present so we don't store an
 * Invalid Date in Mongo.
 */
function subscriptionPeriodEnd(subscription: any): Date {
  const raw =
    subscription?.current_period_end ?? subscription?.items?.data?.[0]?.current_period_end;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(`Stripe subscription ${subscription?.id ?? "?"} is missing current_period_end`);
  }
  return new Date(raw * 1000);
}

// ---------------------------------------------------------------------------
// GET /catalog — public, returns all shop items + ownership for logged-in user
// ---------------------------------------------------------------------------

router.get("/catalog", async (req: Request, res: Response) => {
  try {
    const player = await getPlayerFromRequest(req);
    if (!shopAccessAllowed(player)) {
      return res.status(403).json({
        code: "SHOP_DISABLED",
        message: "The shop is not currently available.",
      });
    }
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
    if (!shopAccessAllowed(player)) {
      return res.status(403).json({
        code: "SHOP_DISABLED",
        message: "The shop is not currently available.",
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
          s.badgeId === item.id && (s.status === "active" || s.status === "past_due"),
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

    // In dev, the frontend runs on a different port than the backend.
    // Use localhost (not 127.0.0.1) to match Next.js dev server origin.
    const origin = FRONTEND_URL || "http://localhost:3000";
    const itemLabel = `${item.type === "badge" ? "Badge" : "Theme"}: ${item.id}`;

    // Ensure Stripe customer exists for subscription items
    let customerId: string | undefined;
    if (item.recurring && account) {
      if (account.stripeCustomerId) {
        customerId = account.stripeCustomerId;
      } else {
        const customer = await stripe.customers.create({
          metadata: { playerId: player.playerId },
        });
        account.stripeCustomerId = customer.id;
        await account.save();
        customerId = customer.id;
      }
    }

    if (item.recurring) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [
          {
            price_data: {
              currency: item.currency,
              unit_amount: item.price,
              recurring: { interval: item.recurring.interval },
              product_data: { name: `${itemLabel} (monthly)` },
            },
            quantity: 1,
          },
        ],
        metadata: {
          playerId: player.playerId,
          itemType: item.type,
          itemId: item.id,
        },
        subscription_data: {
          metadata: {
            playerId: player.playerId,
            itemType: item.type,
            itemId: item.id,
          },
        },
        success_url: `${origin}/shop?success=true&item=${item.type}-${item.id}`,
        cancel_url: `${origin}/shop?cancelled=true`,
      });

      return res.json({ url: session.url });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: item.currency,
            unit_amount: item.price,
            product_data: { name: itemLabel },
          },
          quantity: 1,
        },
      ],
      metadata: {
        playerId: player.playerId,
        itemType: item.type,
        itemId: item.id,
      },
      success_url: `${origin}/shop?success=true&item=${item.type}-${item.id}`,
      cancel_url: `${origin}/shop?cancelled=true`,
    });

    return res.json({ url: session.url });
  } catch (error) {
    return handleRouteError(res, error, "Unable to create checkout session.", req);
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

    // Cancel at end of period — badge stays until current_period_end
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    sub.status = "canceled";
    await account!.save();

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

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const { playerId, itemType, itemId } = session.metadata ?? {};

          if (!playerId || !itemType || !itemId) {
            console.warn("[shop] Webhook missing metadata:", session.metadata);
            break;
          }

          try {
            if (session.mode === "subscription") {
              const subscriptionId = session.subscription;
              if (subscriptionId) {
                const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                const account = await GameAccount.findById(playerId);
                if (account) {
                  const existingIdx = account.activeSubscriptions?.findIndex(
                    (s: ISubscription) => s.subscriptionId === subscriptionId,
                  );
                  const subRecord = {
                    subscriptionId,
                    badgeId: itemId,
                    status: "active" as const,
                    currentPeriodEnd: subscriptionPeriodEnd(subscription),
                  };
                  if (existingIdx !== undefined && existingIdx >= 0) {
                    account.activeSubscriptions[existingIdx] = subRecord;
                  } else {
                    account.activeSubscriptions.push(subRecord);
                  }
                  await account.save();
                }
                await grantBadge(playerId, itemId);
                console.info(`[shop] Subscription badge "${itemId}" granted to ${playerId}`);
              }
            } else {
              if (itemType === "badge") {
                await grantBadge(playerId, itemId);
                console.info(`[shop] Granted badge "${itemId}" to ${playerId}`);
              } else if (itemType === "theme") {
                await grantTheme(playerId, itemId);
                console.info(`[shop] Granted theme "${itemId}" to ${playerId}`);
              }
            }
          } catch (grantErr) {
            console.error("[shop] Failed to grant item:", grantErr);
            // Still return 200 so Stripe doesn't retry indefinitely
          }
          break;
        }

        case "customer.subscription.updated": {
          const subscription = event.data.object;
          const { playerId, itemId } = subscription.metadata ?? {};
          if (!playerId || !itemId) break;

          const account = await GameAccount.findById(playerId);
          if (!account) break;

          const sub = account.activeSubscriptions?.find(
            (s: ISubscription) => s.subscriptionId === subscription.id,
          );
          if (sub) {
            sub.currentPeriodEnd = subscriptionPeriodEnd(subscription);

            if (subscription.status === "active") {
              sub.status = "active";
            } else if (subscription.status === "past_due") {
              sub.status = "past_due";
            } else if (subscription.status === "canceled" || subscription.cancel_at_period_end) {
              sub.status = "canceled";
            }

            await account.save();
            console.info(`[shop] Subscription ${subscription.id} updated: status=${sub.status}`);
          }
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object;
          const { playerId, itemId } = subscription.metadata ?? {};
          if (!playerId || !itemId) break;

          const account = await GameAccount.findById(playerId);
          if (account) {
            account.activeSubscriptions = (account.activeSubscriptions ?? []).filter(
              (s: ISubscription) => s.subscriptionId !== subscription.id,
            );
            await account.save();
          }

          try {
            await revokeBadge(playerId, itemId);
            console.info(`[shop] Subscription badge "${itemId}" revoked from ${playerId}`);
          } catch (err) {
            console.error("[shop] Failed to revoke badge:", err);
          }
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object;
          const subscriptionId = invoice.subscription;
          if (!subscriptionId) break;

          const account = await GameAccount.findOne({
            "activeSubscriptions.subscriptionId": subscriptionId,
          });
          if (account) {
            const sub = account.activeSubscriptions?.find(
              (s: ISubscription) => s.subscriptionId === subscriptionId,
            );
            if (sub) {
              sub.status = "past_due";
              await account.save();
              console.warn(`[shop] Payment failed for subscription ${subscriptionId}`);
            }
          }
          break;
        }
      }

      return res.status(200).json({ received: true });
    } catch (error) {
      console.error("[shop] Webhook error:", error);
      return res.status(500).json({ message: "Webhook processing failed." });
    }
  },
);

export default router;
