import express, { Request, Response } from "express";
import { GameServiceError } from "../game/gameService";
import { tournamentService } from "../game/tournamentService";
import { getPlayerFromRequest } from "../auth/sessionHelper";
import { classifyMongoError } from "../error-handling";
import type { TournamentSettings, TournamentStatus } from "../../shared/src";

const router = express.Router();

async function getAccountPlayer(req: Request, res: Response) {
  const player = await getPlayerFromRequest(req);
  if (!player) {
    res.status(401).json({ code: "NOT_AUTHENTICATED", message: "Sign in to use tournaments." });
    return null;
  }
  if (player.kind !== "account") {
    res.status(403).json({ code: "ACCOUNT_REQUIRED", message: "Tournaments require an account." });
    return null;
  }
  return player;
}

function respondWithError(res: Response, error: unknown, fallback: string) {
  if (error instanceof GameServiceError) {
    return res.status(error.status).json({ code: error.code, message: error.message });
  }
  const mongoError = classifyMongoError(error);
  if (mongoError) {
    return res
      .status(mongoError.status)
      .json({ code: mongoError.code, message: mongoError.message });
  }
  console.error("[tournament-routes] Unhandled error:", error);
  return res.status(500).json({ code: "INTERNAL_ERROR", message: fallback });
}

// GET /tournaments — list public tournaments
router.get("/tournaments", async (req: Request, res: Response) => {
  try {
    const status = req.query.status as TournamentStatus | undefined;
    const tournaments = await tournamentService.listPublicTournaments(status);
    return res.status(200).json({ tournaments });
  } catch (error) {
    return respondWithError(res, error, "Unable to list tournaments.");
  }
});

// GET /tournaments/my — player's tournaments
router.get("/tournaments/my", async (req: Request, res: Response) => {
  const player = await getAccountPlayer(req, res);
  if (!player) return;

  try {
    const tournaments = await tournamentService.listMyTournaments(player.playerId);
    return res.status(200).json({ tournaments });
  } catch (error) {
    return respondWithError(res, error, "Unable to list your tournaments.");
  }
});

// POST /tournaments — create tournament
router.post("/tournaments", async (req: Request, res: Response) => {
  const player = await getAccountPlayer(req, res);
  if (!player) return;

  try {
    const { name, description, settings } = req.body as {
      name: string;
      description?: string;
      settings: TournamentSettings;
    };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res
        .status(400)
        .json({ code: "VALIDATION_ERROR", message: "Tournament name is required." });
    }

    if (!settings || !settings.format) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Tournament settings with format are required.",
      });
    }

    const tournament = await tournamentService.createTournament(
      player,
      settings,
      name.trim(),
      description?.trim(),
    );
    return res.status(201).json({ tournament: tournamentToSnapshot(tournament) });
  } catch (error) {
    return respondWithError(res, error, "Unable to create tournament.");
  }
});

// GET /tournaments/:id — get tournament snapshot
router.get("/tournaments/:id", async (req: Request, res: Response) => {
  try {
    const player = await getPlayerFromRequest(req);
    const snapshot = await tournamentService.getTournamentSnapshot(
      req.params.id,
      player?.playerId,
    );
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return respondWithError(res, error, "Unable to load tournament.");
  }
});

// POST /tournaments/:id/access — access a private tournament via invite code
router.post("/tournaments/:id/access", async (req: Request, res: Response) => {
  const player = await getAccountPlayer(req, res);
  if (!player) return;

  try {
    const { inviteCode } = req.body as { inviteCode: string };
    if (!inviteCode || typeof inviteCode !== "string") {
      return res
        .status(400)
        .json({ code: "VALIDATION_ERROR", message: "Invite code is required." });
    }

    await tournamentService.accessTournament(req.params.id, player.playerId, inviteCode);
    const snapshot = await tournamentService.getTournamentSnapshot(req.params.id, player.playerId);
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return respondWithError(res, error, "Unable to access tournament.");
  }
});

// POST /tournaments/:id/register — register
router.post("/tournaments/:id/register", async (req: Request, res: Response) => {
  const player = await getAccountPlayer(req, res);
  if (!player) return;

  try {
    const { inviteCode } = req.body as { inviteCode?: string };
    await tournamentService.registerPlayer(req.params.id, player, inviteCode);
    const snapshot = await tournamentService.getTournamentSnapshot(req.params.id);
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return respondWithError(res, error, "Unable to register for tournament.");
  }
});

// POST /tournaments/:id/unregister — unregister
router.post("/tournaments/:id/unregister", async (req: Request, res: Response) => {
  const player = await getAccountPlayer(req, res);
  if (!player) return;

  try {
    await tournamentService.unregisterPlayer(req.params.id, player.playerId);
    const snapshot = await tournamentService.getTournamentSnapshot(req.params.id);
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return respondWithError(res, error, "Unable to unregister from tournament.");
  }
});

// POST /tournaments/:id/start — start tournament (admin)
router.post("/tournaments/:id/start", async (req: Request, res: Response) => {
  const player = await getAccountPlayer(req, res);
  if (!player) return;

  try {
    await tournamentService.startTournament(req.params.id, player.playerId);
    const snapshot = await tournamentService.getTournamentSnapshot(req.params.id);
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return respondWithError(res, error, "Unable to start tournament.");
  }
});

// POST /tournaments/:id/cancel — cancel tournament (admin)
router.post("/tournaments/:id/cancel", async (req: Request, res: Response) => {
  const player = await getAccountPlayer(req, res);
  if (!player) return;

  try {
    await tournamentService.cancelTournament(req.params.id, player.playerId);
    const snapshot = await tournamentService.getTournamentSnapshot(req.params.id);
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return respondWithError(res, error, "Unable to cancel tournament.");
  }
});

// PUT /tournaments/:id/seeding — update seeds (admin)
router.put("/tournaments/:id/seeding", async (req: Request, res: Response) => {
  const player = await getAccountPlayer(req, res);
  if (!player) return;

  try {
    const { seeds } = req.body as { seeds: { playerId: string; seed: number }[] };
    if (!Array.isArray(seeds)) {
      return res
        .status(400)
        .json({ code: "VALIDATION_ERROR", message: "Seeds array is required." });
    }

    await tournamentService.updateSeeding(req.params.id, player.playerId, seeds);
    const snapshot = await tournamentService.getTournamentSnapshot(req.params.id);
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return respondWithError(res, error, "Unable to update seeding.");
  }
});

// POST /tournaments/:id/seeding/randomize — randomize seeds (admin)
router.post("/tournaments/:id/seeding/randomize", async (req: Request, res: Response) => {
  const player = await getAccountPlayer(req, res);
  if (!player) return;

  try {
    await tournamentService.randomizeSeeding(req.params.id, player.playerId);
    const snapshot = await tournamentService.getTournamentSnapshot(req.params.id);
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return respondWithError(res, error, "Unable to randomize seeding.");
  }
});

// PUT /tournaments/:id/featured-match — set featured match (admin)
router.put("/tournaments/:id/featured-match", async (req: Request, res: Response) => {
  const player = await getAccountPlayer(req, res);
  if (!player) return;

  try {
    const { matchId } = req.body as { matchId: string | null };
    await tournamentService.setFeaturedMatch(req.params.id, player.playerId, matchId);
    const snapshot = await tournamentService.getTournamentSnapshot(req.params.id);
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return respondWithError(res, error, "Unable to set featured match.");
  }
});

// POST /tournaments/:id/matches/:matchId/forfeit — admin-forfeit
router.post("/tournaments/:id/matches/:matchId/forfeit", async (req: Request, res: Response) => {
  const player = await getAccountPlayer(req, res);
  if (!player) return;

  try {
    const { loserId } = req.body as { loserId: string };
    if (!loserId) {
      return res.status(400).json({ code: "VALIDATION_ERROR", message: "loserId is required." });
    }

    await tournamentService.forfeitMatch(
      req.params.id,
      req.params.matchId,
      loserId,
      player.playerId,
    );
    const snapshot = await tournamentService.getTournamentSnapshot(req.params.id);
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return respondWithError(res, error, "Unable to forfeit match.");
  }
});

// Helper: convert stored tournament to snapshot (for POST responses before the service creates a snapshot)
function tournamentToSnapshot(t: any) {
  return {
    tournamentId: t.tournamentId,
    name: t.name,
    description: t.description,
    creatorId: t.creatorId,
    status: t.status,
    settings: t.settings,
    participants: t.participants,
    rounds: t.rounds,
    groups: t.groups,
    knockoutRounds: t.knockoutRounds,
    featuredMatchId: t.featuredMatchId,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
    updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt,
  };
}

export default router;
