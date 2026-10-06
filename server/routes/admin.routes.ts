import express, { type Request, type Response } from "express";
import { requireAdmin } from "../auth/sessionHelper";
import { escapeRegExp } from "../error-handling/escapeRegExp";
import { handleRouteError } from "../error-handling/routeError";
import {
  adminGrantAchievement,
  adminRevokeAchievement,
  getPlayerAchievementIds,
  getPlayerAchievementIdsBatch,
} from "../game/achievementService";
import { grantBadge, grantTheme, revokeBadge, revokeTheme } from "../game/badgeService";
import { tournamentService } from "../game/tournamentService";
import GameAccount from "../models/GameAccount";

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /admin/users/search?q=<query> — search users by display name
// ---------------------------------------------------------------------------

router.get("/users/search", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const query = (req.query.q as string)?.trim();
  if (!query || query.length < 1) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Search query is required.",
    });
  }

  try {
    const escapedQuery = escapeRegExp(query);
    const accounts = await GameAccount.find(
      { displayName: { $regex: escapedQuery, $options: "i" } },
      { displayName: 1, profilePicture: 1, badges: 1, activeBadges: 1, unlockedThemes: 1 },
    )
      .limit(20)
      .lean();

    // Batch-fetch achievements for all accounts in one query instead of N.
    const playerIds = accounts.map((a: any) => String(a._id));
    const achievementsByPlayer = await getPlayerAchievementIdsBatch(playerIds);

    const users = accounts.map((account: any) => ({
      playerId: String(account._id),
      displayName: account.displayName,
      profilePicture: account.profilePicture,
      badges: account.badges ?? [],
      activeBadges: account.activeBadges ?? [],
      unlockedThemes: account.unlockedThemes ?? [],
      achievements: achievementsByPlayer.get(String(account._id)) ?? [],
    }));

    return res.status(200).json({ users });
  } catch (error) {
    console.error("[GET /admin/users/search] Error:", error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Unable to search users right now.",
    });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/badges/grant — grant a badge to a user
// ---------------------------------------------------------------------------

router.post("/badges/grant", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { playerId, badgeId } = req.body as { playerId?: string; badgeId?: string };
  if (!playerId || !badgeId) {
    return res
      .status(400)
      .json({ code: "VALIDATION_ERROR", message: "playerId and badgeId are required." });
  }
  try {
    return res.status(200).json(await grantBadge(playerId, badgeId));
  } catch (error) {
    return handleRouteError(res, error, "Unable to grant badge right now.", req);
  }
});

router.post("/badges/revoke", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { playerId, badgeId } = req.body as { playerId?: string; badgeId?: string };
  if (!playerId || !badgeId) {
    return res
      .status(400)
      .json({ code: "VALIDATION_ERROR", message: "playerId and badgeId are required." });
  }
  try {
    return res.status(200).json(await revokeBadge(playerId, badgeId));
  } catch (error) {
    return handleRouteError(res, error, "Unable to revoke badge right now.", req);
  }
});

router.post("/themes/grant", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { playerId, themeId } = req.body as { playerId?: string; themeId?: string };
  if (!playerId || !themeId) {
    return res
      .status(400)
      .json({ code: "VALIDATION_ERROR", message: "playerId and themeId are required." });
  }
  try {
    return res.status(200).json(await grantTheme(playerId, themeId));
  } catch (error) {
    return handleRouteError(res, error, "Unable to grant theme right now.", req);
  }
});

router.post("/themes/revoke", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { playerId, themeId } = req.body as { playerId?: string; themeId?: string };
  if (!playerId || !themeId) {
    return res
      .status(400)
      .json({ code: "VALIDATION_ERROR", message: "playerId and themeId are required." });
  }
  try {
    return res.status(200).json(await revokeTheme(playerId, themeId));
  } catch (error) {
    return handleRouteError(res, error, "Unable to revoke theme right now.", req);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/achievements/grant — grant an achievement to a user
// ---------------------------------------------------------------------------

router.post("/achievements/grant", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { playerId, achievementId } = req.body as {
    playerId?: string;
    achievementId?: string;
  };
  if (!playerId || !achievementId) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "playerId and achievementId are required.",
    });
  }
  try {
    const granted = await adminGrantAchievement(playerId, achievementId);
    const achievements = await getPlayerAchievementIds(playerId);
    return res.status(200).json({ granted, achievements });
  } catch (error) {
    return handleRouteError(res, error, "Unable to grant achievement right now.", req);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/achievements/revoke — revoke an achievement from a user
// ---------------------------------------------------------------------------

router.post("/achievements/revoke", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { playerId, achievementId } = req.body as {
    playerId?: string;
    achievementId?: string;
  };
  if (!playerId || !achievementId) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "playerId and achievementId are required.",
    });
  }
  try {
    const revoked = await adminRevokeAchievement(playerId, achievementId);
    const achievements = await getPlayerAchievementIds(playerId);
    return res.status(200).json({ revoked, achievements });
  } catch (error) {
    return handleRouteError(res, error, "Unable to revoke achievement right now.", req);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/tournaments — list every tournament (public + private) for admin
// ---------------------------------------------------------------------------

router.get("/tournaments", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const tournaments = await tournamentService.listAllTournamentsForAdmin();
    return res.status(200).json({ tournaments });
  } catch (error) {
    return handleRouteError(res, error, "Unable to list tournaments right now.", req);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/tournaments/:id/featured — toggle the "featured" flag
// ---------------------------------------------------------------------------

router.post("/tournaments/:id/featured", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { featured } = req.body as { featured?: boolean };
  if (typeof featured !== "boolean") {
    return res
      .status(400)
      .json({ code: "VALIDATION_ERROR", message: "featured (boolean) is required." });
  }
  try {
    await tournamentService.setFeatured(req.params.id as string, featured);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return handleRouteError(res, error, "Unable to update featured flag.", req);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/tournaments/:id/dev-force-match-result — DEV ONLY
// Fabricates a match result so we can exercise mid-tournament flow states
// without having to play 50 real games. Guarded by NODE_ENV !== "production".
// ---------------------------------------------------------------------------

router.post("/tournaments/:id/dev-force-match-result", async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    return res
      .status(404)
      .json({ code: "NOT_FOUND", message: "Dev-only endpoint is not available." });
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { matchId, winnerId, scoreWhite, scoreBlack, finishReason } = req.body as {
    matchId?: string;
    winnerId?: string;
    scoreWhite?: number;
    scoreBlack?: number;
    finishReason?: string;
  };
  if (!matchId || !winnerId) {
    return res
      .status(400)
      .json({ code: "VALIDATION_ERROR", message: "matchId and winnerId are required." });
  }
  try {
    await tournamentService.devForceMatchResult(req.params.id as string, matchId, {
      winnerId,
      scoreWhite: scoreWhite ?? 10,
      scoreBlack: scoreBlack ?? 0,
      finishReason: (finishReason as "captured" | "forfeit" | "timeout" | undefined) ?? "captured",
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    return handleRouteError(res, error, "Unable to force match result.", req);
  }
});

export default router;
