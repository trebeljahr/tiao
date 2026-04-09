import express, { Request, Response } from "express";
import { tournamentService } from "../game/tournamentService";
import { getPlayerFromRequest } from "../auth/sessionHelper";
import { handleRouteError } from "../error-handling/routeError";
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

function tournamentAction(
  action: (tournamentId: string, playerId: string) => Promise<unknown>,
  errorMsg: string,
) {
  return async (req: Request, res: Response) => {
    const player = await getAccountPlayer(req, res);
    if (!player) return;
    try {
      await action(req.params.id as string, player.playerId);
      const snapshot = await tournamentService.getTournamentSnapshot(req.params.id as string);
      return res.status(200).json({ tournament: snapshot });
    } catch (error) {
      return handleRouteError(res, error, errorMsg, req);
    }
  };
}

// GET /tournaments — list public tournaments
router.get("/tournaments", async (req: Request, res: Response) => {
  try {
    const status = req.query.status as TournamentStatus | undefined;
    const tournaments = await tournamentService.listPublicTournaments(status);
    return res.status(200).json({ tournaments });
  } catch (error) {
    return handleRouteError(res, error, "Unable to list tournaments.", req);
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
    return handleRouteError(res, error, "Unable to list your tournaments.", req);
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
    return handleRouteError(res, error, "Unable to create tournament.", req);
  }
});

// GET /tournaments/:id — get tournament snapshot
router.get("/tournaments/:id", async (req: Request, res: Response) => {
  try {
    const player = await getPlayerFromRequest(req);
    const snapshot = await tournamentService.getTournamentSnapshot(
      req.params.id as string,
      player?.playerId,
    );
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return handleRouteError(res, error, "Unable to load tournament.", req);
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

    await tournamentService.accessTournament(req.params.id as string, player.playerId, inviteCode);
    const snapshot = await tournamentService.getTournamentSnapshot(
      req.params.id as string,
      player.playerId,
    );
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return handleRouteError(res, error, "Unable to access tournament.", req);
  }
});

// POST /tournaments/:id/register — register
router.post("/tournaments/:id/register", async (req: Request, res: Response) => {
  const player = await getAccountPlayer(req, res);
  if (!player) return;

  try {
    const { inviteCode } = req.body as { inviteCode?: string };
    await tournamentService.registerPlayer(req.params.id as string, player, inviteCode);
    const snapshot = await tournamentService.getTournamentSnapshot(req.params.id as string);
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return handleRouteError(res, error, "Unable to register for tournament.", req);
  }
});

// POST /tournaments/:id/unregister — unregister
router.post(
  "/tournaments/:id/unregister",
  tournamentAction(
    (id, playerId) => tournamentService.unregisterPlayer(id, playerId),
    "Unable to unregister from tournament.",
  ),
);

// POST /tournaments/:id/start — start tournament (admin)
router.post(
  "/tournaments/:id/start",
  tournamentAction(
    (id, playerId) => tournamentService.startTournament(id, playerId),
    "Unable to start tournament.",
  ),
);

// POST /tournaments/:id/cancel — cancel tournament (admin)
router.post(
  "/tournaments/:id/cancel",
  tournamentAction(
    (id, playerId) => tournamentService.cancelTournament(id, playerId),
    "Unable to cancel tournament.",
  ),
);

// DELETE /tournaments/:id — permanently delete a cancelled tournament (admin)
router.delete("/tournaments/:id", async (req: Request, res: Response) => {
  const player = await getAccountPlayer(req, res);
  if (!player) return;

  try {
    await tournamentService.deleteTournament(req.params.id as string, player.playerId);
    return res.status(204).end();
  } catch (error) {
    return handleRouteError(res, error, "Unable to delete tournament.", req);
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

    await tournamentService.updateSeeding(req.params.id as string, player.playerId, seeds);
    const snapshot = await tournamentService.getTournamentSnapshot(req.params.id as string);
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return handleRouteError(res, error, "Unable to update seeding.", req);
  }
});

// POST /tournaments/:id/seeding/randomize — randomize seeds (admin)
router.post(
  "/tournaments/:id/seeding/randomize",
  tournamentAction(
    (id, playerId) => tournamentService.randomizeSeeding(id, playerId),
    "Unable to randomize seeding.",
  ),
);

// PUT /tournaments/:id/featured-match — set featured match (admin)
router.put("/tournaments/:id/featured-match", async (req: Request, res: Response) => {
  const player = await getAccountPlayer(req, res);
  if (!player) return;

  try {
    const { matchId } = req.body as { matchId: string | null };
    await tournamentService.setFeaturedMatch(req.params.id as string, player.playerId, matchId);
    const snapshot = await tournamentService.getTournamentSnapshot(req.params.id as string);
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return handleRouteError(res, error, "Unable to set featured match.", req);
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
      req.params.id as string,
      req.params.matchId as string,
      loserId,
      player.playerId,
    );
    const snapshot = await tournamentService.getTournamentSnapshot(req.params.id as string);
    return res.status(200).json({ tournament: snapshot });
  } catch (error) {
    return handleRouteError(res, error, "Unable to forfeit match.", req);
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
