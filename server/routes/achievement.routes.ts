import { Router, Request, Response } from "express";
import { getPlayerFromRequest } from "../auth/sessionHelper";
import GameAccount from "../models/GameAccount";
import { getPlayerAchievements, onAIGameWon } from "../game/achievementService";
import { ACHIEVEMENTS } from "../../shared/src/achievements";

const router = Router();

// ---------------------------------------------------------------------------
// GET /achievements — own achievements (authenticated)
// ---------------------------------------------------------------------------

router.get("/achievements", async (req: Request, res: Response) => {
  try {
    const player = await getPlayerFromRequest(req);
    if (!player || player.kind !== "account") {
      return res.status(401).json({ error: "Authentication required." });
    }

    const unlocked = await getPlayerAchievements(player.playerId);
    return res.json({ achievements: unlocked, definitions: ACHIEVEMENTS });
  } catch (error) {
    console.error("[achievements] Error fetching own achievements:", error);
    return res.status(500).json({ error: "Unable to load achievements." });
  }
});

// ---------------------------------------------------------------------------
// GET /profile/:username/achievements — public achievements for a player
// ---------------------------------------------------------------------------

router.get("/profile/:username/achievements", async (req: Request, res: Response) => {
  try {
    const username = req.params.username as string;
    const account = await GameAccount.findOne({
      displayName: { $regex: new RegExp(`^${escapeRegex(username)}$`, "i") },
    });

    if (!account) {
      return res.status(404).json({ error: "Player not found." });
    }

    const unlocked = await getPlayerAchievements(account.id);
    return res.json({ achievements: unlocked, definitions: ACHIEVEMENTS });
  } catch (error) {
    console.error("[achievements] Error fetching player achievements:", error);
    return res.status(500).json({ error: "Unable to load achievements." });
  }
});

// ---------------------------------------------------------------------------
// POST /achievements/ai-win — report an AI game win (client-side games)
// ---------------------------------------------------------------------------

router.post("/achievements/ai-win", async (req: Request, res: Response) => {
  try {
    const player = await getPlayerFromRequest(req);
    if (!player || player.kind !== "account") {
      return res.status(401).json({ error: "Authentication required." });
    }

    const { difficulty } = req.body;
    if (![1, 2, 3].includes(difficulty)) {
      return res.status(400).json({ error: "Invalid difficulty." });
    }

    await onAIGameWon(player.playerId, difficulty);
    return res.json({ ok: true });
  } catch (error) {
    console.error("[achievements] Error reporting AI win:", error);
    return res.status(500).json({ error: "Unable to process AI win." });
  }
});

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default router;
