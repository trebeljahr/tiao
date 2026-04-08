import express, { Request, Response } from "express";
import { getPlayerFromRequest } from "../auth/sessionHelper";
import GameAccount from "../models/GameAccount";
import { grantBadge, grantTheme } from "../game/badgeService";
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

    // Check if already owned
    const account = await GameAccount.findById(player.playerId);
    if (account) {
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

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const { playerId, itemType, itemId } = session.metadata ?? {};

        if (!playerId || !itemType || !itemId) {
          console.warn("[shop] Webhook missing metadata:", session.metadata);
          return res.status(200).json({ received: true });
        }

        try {
          if (itemType === "badge") {
            await grantBadge(playerId, itemId);
            console.info(`[shop] Granted badge "${itemId}" to ${playerId}`);
          } else if (itemType === "theme") {
            await grantTheme(playerId, itemId);
            console.info(`[shop] Granted theme "${itemId}" to ${playerId}`);
          }
        } catch (grantErr) {
          console.error("[shop] Failed to grant item:", grantErr);
          // Still return 200 so Stripe doesn't retry indefinitely
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
