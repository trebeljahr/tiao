import express, { Request, Response } from "express";
import mongoose from "mongoose";
import { classifyMongoError } from "../error-handling";
import { gameService, GameServiceError } from "../game/gameService";
import { getPlayerFromRequest } from "../game/playerTokens";
import GameInvitation from "../models/GameInvitation";

const router = express.Router();

async function getAuthenticatedPlayer(req: Request, res: Response) {
  const player = await getPlayerFromRequest(req);
  if (!player) {
    res.status(401).json({
      code: "NOT_AUTHENTICATED",
      message: "Authenticate as a guest or account before using multiplayer.",
    });
    return null;
  }

  return player;
}

const GAME_ID_PATTERN = /^[A-Z2-9]{6}$/;

function isValidGameId(gameId: string): boolean {
  return GAME_ID_PATTERN.test(gameId.trim().toUpperCase());
}

function respondWithGameServiceError(
  res: Response,
  error: unknown,
  fallbackMessage: string
) {
  if (error instanceof GameServiceError) {
    return res.status(error.status).json({
      code: error.code,
      message: error.message,
    });
  }

  const mongoError = classifyMongoError(error);
  if (mongoError) {
    console.warn(`[game-routes] MongoDB ${mongoError.code}:`, error);
    return res.status(mongoError.status).json({
      code: mongoError.code,
      message: mongoError.message,
    });
  }

  console.error("[game-routes] Unhandled error:", error);
  return res.status(500).json({
    code: "INTERNAL_ERROR",
    message: fallbackMessage,
  });
}

async function acceptPendingInvitationsForPlayer(
  gameId: string,
  playerId: string
) {
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  await GameInvitation.updateMany(
    {
      gameId: gameId.trim().toUpperCase(),
      recipientId: playerId,
      status: "pending",
      expiresAt: {
        $gt: new Date(),
      },
    },
    {
      $set: {
        status: "accepted",
      },
    }
  );
}

/**
 * When a second player joins a game, revoke ALL remaining pending invitations
 * for that gameId and notify affected players so their UIs update in real time.
 */
async function revokeAllPendingInvitationsForGame(gameId: string) {
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  const normalizedGameId = gameId.trim().toUpperCase();

  const pendingInvitations = await GameInvitation.find({
    gameId: normalizedGameId,
    status: "pending",
    expiresAt: { $gt: new Date() },
  });

  if (pendingInvitations.length === 0) return;

  await GameInvitation.updateMany(
    {
      gameId: normalizedGameId,
      status: "pending",
      expiresAt: { $gt: new Date() },
    },
    { $set: { status: "revoked" } }
  );

  // Collect unique player IDs that need a social-update notification
  const affectedPlayerIds = new Set<string>();
  for (const inv of pendingInvitations) {
    affectedPlayerIds.add(inv.senderId.toString());
    affectedPlayerIds.add(inv.recipientId.toString());
  }

  // Notify each affected player via lobby websocket
  for (const playerId of affectedPlayerIds) {
    gameService.broadcastLobby(playerId, {
      type: "social-update",
    });
  }
}

/**
 * @openapi
 * /api/games:
 *   get:
 *     summary: List the current player's games
 *     tags:
 *       - Games
 *     security:
 *       - sessionCookie: []
 *     responses:
 *       200:
 *         description: List of games
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 games:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MultiplayerSnapshot'
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.get("/games", async (req: Request, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  try {
    const games = await gameService.listGames(player);
    return res.status(200).json({ games });
  } catch (error) {
    return respondWithGameServiceError(
      res,
      error,
      "Unable to load your multiplayer games right now."
    );
  }
});

/**
 * @openapi
 * /api/games:
 *   post:
 *     summary: Create a new multiplayer game
 *     tags:
 *       - Games
 *     security:
 *       - sessionCookie: []
 *     responses:
 *       201:
 *         description: Game created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 snapshot:
 *                   $ref: '#/components/schemas/MultiplayerSnapshot'
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.post("/games", async (req: Request, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  try {
    const snapshot = await gameService.createGame(player);
    return res.status(201).json({ snapshot });
  } catch (error) {
    return respondWithGameServiceError(
      res,
      error,
      "Unable to create a multiplayer game right now."
    );
  }
});

/**
 * @openapi
 * /api/games/{gameId}/join:
 *   post:
 *     summary: Join an existing game
 *     tags:
 *       - Games
 *     security:
 *       - sessionCookie: []
 *     parameters:
 *       - in: path
 *         name: gameId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Joined the game
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 snapshot:
 *                   $ref: '#/components/schemas/MultiplayerSnapshot'
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.post("/games/:gameId/join", async (req: Request, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  if (!isValidGameId(req.params.gameId)) {
    return res.status(400).json({ code: "INVALID_GAME_ID", message: "Invalid game ID." });
  }

  try {
    const snapshot = await gameService.joinGame(req.params.gameId, player);

    // When the game is now active (2 players joined), revoke all remaining invites
    if (snapshot.status === "active") {
      void revokeAllPendingInvitationsForGame(snapshot.gameId);
    }

    return res.status(200).json({ snapshot });
  } catch (error) {
    return respondWithGameServiceError(
      res,
      error,
      "Unable to join that game right now."
    );
  }
});

/**
 * @openapi
 * /api/games/{gameId}/access:
 *   post:
 *     summary: Access a game (join or spectate)
 *     tags:
 *       - Games
 *     security:
 *       - sessionCookie: []
 *     parameters:
 *       - in: path
 *         name: gameId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Game accessed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 snapshot:
 *                   $ref: '#/components/schemas/MultiplayerSnapshot'
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.post("/games/:gameId/access", async (req: Request, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  if (!isValidGameId(req.params.gameId)) {
    return res.status(400).json({ code: "INVALID_GAME_ID", message: "Invalid game ID." });
  }

  try {
    const snapshot = await gameService.accessGame(req.params.gameId, player);

    if (player.kind === "account") {
      await acceptPendingInvitationsForPlayer(snapshot.gameId, player.playerId);
    }

    // When the game is now active (2 players joined), revoke all remaining invites
    if (snapshot.status === "active") {
      void revokeAllPendingInvitationsForGame(snapshot.gameId);
    }

    return res.status(200).json({ snapshot });
  } catch (error) {
    return respondWithGameServiceError(
      res,
      error,
      "Unable to open that game right now."
    );
  }
});

/**
 * @openapi
 * /api/games/{gameId}:
 *   get:
 *     summary: Get a game snapshot
 *     tags:
 *       - Games
 *     security:
 *       - sessionCookie: []
 *     parameters:
 *       - in: path
 *         name: gameId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Game snapshot
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 snapshot:
 *                   $ref: '#/components/schemas/MultiplayerSnapshot'
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.get("/games/:gameId", async (req: Request, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  if (!isValidGameId(req.params.gameId)) {
    return res.status(400).json({ code: "INVALID_GAME_ID", message: "Invalid game ID." });
  }

  try {
    const snapshot = await gameService.getSnapshot(req.params.gameId);
    return res.status(200).json({ snapshot });
  } catch (error) {
    return respondWithGameServiceError(
      res,
      error,
      "Unable to load that game right now."
    );
  }
});

/**
 * @openapi
 * /api/matchmaking:
 *   post:
 *     summary: Enter matchmaking queue
 *     tags:
 *       - Matchmaking
 *     security:
 *       - sessionCookie: []
 *     responses:
 *       200:
 *         description: Entered matchmaking
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 matchmaking:
 *                   $ref: '#/components/schemas/MatchmakingState'
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.post("/matchmaking", async (req: Request, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  try {
    const raw = req.body?.timeControl ?? null;
    let timeControl: { initialMs: number; incrementMs: number } | null = null;

    if (raw !== null) {
      const initialMs = Number(raw?.initialMs);
      const incrementMs = Number(raw?.incrementMs);

      if (
        !Number.isFinite(initialMs) ||
        !Number.isFinite(incrementMs) ||
        initialMs <= 0 ||
        incrementMs < 0
      ) {
        return res.status(400).json({
          code: "INVALID_TIME_CONTROL",
          message:
            "Invalid time control. Provide positive initialMs and non-negative incrementMs.",
        });
      }

      timeControl = { initialMs, incrementMs };
    }

    const matchmaking = await gameService.enterMatchmaking(player, timeControl);
    return res.status(200).json({ matchmaking });
  } catch (error) {
    return respondWithGameServiceError(
      res,
      error,
      "Unable to enter matchmaking right now."
    );
  }
});

/**
 * @openapi
 * /api/matchmaking:
 *   get:
 *     summary: Get current matchmaking status
 *     tags:
 *       - Matchmaking
 *     security:
 *       - sessionCookie: []
 *     responses:
 *       200:
 *         description: Matchmaking state
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 matchmaking:
 *                   $ref: '#/components/schemas/MatchmakingState'
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.get("/matchmaking", async (req: Request, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  try {
    const matchmaking = await gameService.getMatchmakingState(player);
    return res.status(200).json({ matchmaking });
  } catch (error) {
    return respondWithGameServiceError(
      res,
      error,
      "Unable to load matchmaking right now."
    );
  }
});

/**
 * @openapi
 * /api/matchmaking:
 *   delete:
 *     summary: Leave matchmaking queue
 *     tags:
 *       - Matchmaking
 *     security:
 *       - sessionCookie: []
 *     responses:
 *       204:
 *         description: Left matchmaking
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 */
router.delete("/matchmaking", async (req: Request, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  try {
    await gameService.leaveMatchmaking(player);
    return res.status(204).send();
  } catch (error) {
    return respondWithGameServiceError(
      res,
      error,
      "Unable to leave matchmaking right now."
    );
  }
});

/**
 * @openapi
 * /api/games/{gameId}/test-finish:
 *   post:
 *     summary: Force-finish a game (development only)
 *     tags:
 *       - Games
 *     parameters:
 *       - in: path
 *         name: gameId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - winner
 *             properties:
 *               winner:
 *                 type: string
 *                 enum: [white, black]
 *     responses:
 *       200:
 *         description: Game finished
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       403:
 *         description: Not allowed in production
 *       500:
 *         description: Failed to finish game
 */
router.post("/games/:gameId/test-finish", async (req: Request, res: Response) => {
  if (process.env.NODE_ENV !== "test") {
    return res.status(403).json({ code: "FORBIDDEN", message: "Only available in test environment." });
  }

  const { gameId } = req.params;
  const { winner } = req.body as { winner: string };

  if (typeof winner !== "string" || (winner !== "white" && winner !== "black")) {
    return res.status(400).json({ code: "VALIDATION_ERROR", message: "Winner must be 'white' or 'black'." });
  }

  try {
    await gameService.testForceFinishGame(gameId, winner);
    res.status(200).json({ message: "Game finished." });
  } catch (error) {
    res.status(500).json({ code: "INTERNAL_ERROR", message: "Failed to finish game." });
  }
});

export default router;
