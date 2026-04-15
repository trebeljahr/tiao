import express, { type Request as ExpressRequest, type Response } from "express";
import mongoose from "mongoose";
import { handleRouteError } from "../error-handling/routeError";
import { gameService } from "../game/gameService";
import { getPlayerFromRequest } from "../auth/sessionHelper";
import { applySsoProfilePicturesToSummaries } from "../auth/ssoProfilePicture";
import GameInvitation from "../models/GameInvitation";
import GameAccount from "../models/GameAccount";
import GameRoom, { type IGameRoom } from "../models/GameRoom";
import { PlayerIdentity } from "../../shared/src";
import { notifyLobbyUpdate } from "./social.routes";
import { gameActionRateLimiter } from "../middleware/rateLimiter";

const router = express.Router();

async function getAuthenticatedPlayer(req: ExpressRequest, res: Response) {
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

const GUEST_GAME_LIMIT = 10;

async function checkGuestGameLimit(player: PlayerIdentity, res: Response): Promise<boolean> {
  if (player.kind !== "guest") return true;
  if (process.env.NODE_ENV === "test") return true;
  const count = await GameRoom.countDocuments({
    $or: [{ "seats.white.playerId": player.playerId }, { "seats.black.playerId": player.playerId }],
  });
  if (count >= GUEST_GAME_LIMIT) {
    res.status(403).json({
      code: "GUEST_LIMIT_REACHED",
      message: `Guest players can play up to ${GUEST_GAME_LIMIT} games. Create an account to continue.`,
    });
    return false;
  }
  return true;
}

async function checkGuestCustomGameGate(
  player: PlayerIdentity,
  gameId: string,
  res: Response,
): Promise<boolean> {
  if (player.kind !== "guest") return true;
  const room = await GameRoom.findOne({ roomId: gameId })
    .select("roomType")
    .lean<Pick<IGameRoom, "roomType">>();
  if (room && room.roomType === "direct") {
    res.status(403).json({
      code: "GUEST_CANNOT_JOIN_CUSTOM_GAME",
      message: "Create an account or sign in to join a custom game.",
    });
    return false;
  }
  return true;
}

/**
 * Tournament games are not joinable by invite-link or game-ID sharing —
 * pairings are matched automatically by the tournament service. Anyone
 * reaching a tournament game room who isn't one of the two seated players
 * should drop into spectator mode via `accessGame`, not the JOIN endpoint.
 */
async function checkTournamentJoinBlock(gameId: string, res: Response): Promise<boolean> {
  const room = await GameRoom.findOne({ roomId: gameId })
    .select("roomType")
    .lean<Pick<IGameRoom, "roomType">>();
  if (room && room.roomType === "tournament") {
    res.status(403).json({
      code: "TOURNAMENT_NO_JOIN",
      message: "Tournament games can't be joined by ID — register for the tournament instead.",
    });
    return false;
  }
  return true;
}

const GAME_ID_PATTERN = /^[A-Z2-9]{6}$/;

function isValidGameId(gameId: string): boolean {
  return GAME_ID_PATTERN.test(gameId.trim().toUpperCase());
}

async function acceptPendingInvitationsForPlayer(gameId: string, playerId: string) {
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
    },
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
    { $set: { status: "revoked" } },
  );

  // Collect unique player IDs that need a social-update notification
  const affectedPlayerIds = new Set<string>();
  for (const inv of pendingInvitations) {
    affectedPlayerIds.add(inv.senderId.toString());
    affectedPlayerIds.add(inv.recipientId.toString());
  }

  // Send full social overview so clients update immediately without a re-fetch
  await Promise.all(
    Array.from(affectedPlayerIds).map((playerId) =>
      notifyLobbyUpdate(playerId).catch((err) => {
        console.error("[game] Failed to notify lobby update for", playerId, err);
      }),
    ),
  );
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
router.get("/games", async (req: ExpressRequest, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  try {
    const games = await gameService.listGames(player);
    await applySsoProfilePicturesToSummaries([...games.active, ...games.finished]);
    return res.status(200).json({ games });
  } catch (error) {
    return handleRouteError(res, error, "Unable to load your multiplayer games right now.", req);
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
router.post("/games", gameActionRateLimiter, async (req: ExpressRequest, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }
  if (!(await checkGuestGameLimit(player, res))) return;

  try {
    const { boardSize, scoreToWin, timeControl, creatorColor } = req.body ?? {};
    const gameSettings =
      boardSize != null || scoreToWin != null
        ? {
            boardSize: boardSize != null ? Number(boardSize) : undefined,
            scoreToWin: scoreToWin != null ? Number(scoreToWin) : undefined,
          }
        : undefined;
    const parsedTimeControl =
      timeControl &&
      typeof timeControl === "object" &&
      typeof timeControl.initialMs === "number" &&
      typeof timeControl.incrementMs === "number"
        ? { initialMs: timeControl.initialMs, incrementMs: timeControl.incrementMs }
        : undefined;
    const parsedCreatorColor =
      creatorColor === "white" || creatorColor === "black" ? creatorColor : undefined;
    const snapshot = await gameService.createGame(player, {
      gameSettings,
      timeControl: parsedTimeControl,
      creatorColor: parsedCreatorColor,
    });
    return res.status(201).json({ snapshot });
  } catch (error) {
    return handleRouteError(res, error, "Unable to create a multiplayer game right now.", req);
  }
});

router.delete("/games/:gameId", async (req: ExpressRequest, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) return;

  try {
    const gameId = (req.params.gameId as string)?.trim().toUpperCase();
    if (!gameId) {
      return res.status(400).json({ code: "INVALID_GAME_ID", message: "Game ID is required." });
    }
    await gameService.cancelWaitingRoom(gameId, player);
    return res.status(200).json({ message: "Game cancelled." });
  } catch (error) {
    return handleRouteError(res, error, "Unable to cancel that game.", req);
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
router.post(
  "/games/:gameId/join",
  gameActionRateLimiter,
  async (req: ExpressRequest, res: Response) => {
    const player = await getAuthenticatedPlayer(req, res);
    if (!player) {
      return;
    }

    if (!isValidGameId(req.params.gameId as string)) {
      return res.status(400).json({ code: "INVALID_GAME_ID", message: "Invalid game ID." });
    }

    if (!(await checkGuestCustomGameGate(player, req.params.gameId as string, res))) {
      return;
    }

    if (!(await checkTournamentJoinBlock(req.params.gameId as string, res))) {
      return;
    }

    try {
      const snapshot = await gameService.joinGame(req.params.gameId as string, player);

      // When the game is now active (2 players joined), revoke all remaining invites
      if (snapshot.status === "active") {
        void revokeAllPendingInvitationsForGame(snapshot.gameId);
      }

      return res.status(200).json({ snapshot });
    } catch (error) {
      return handleRouteError(res, error, "Unable to join that game right now.", req);
    }
  },
);

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
router.post("/games/:gameId/access", async (req: ExpressRequest, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  if (!isValidGameId(req.params.gameId as string)) {
    return res.status(400).json({ code: "INVALID_GAME_ID", message: "Invalid game ID." });
  }

  if (!(await checkGuestCustomGameGate(player, req.params.gameId as string, res))) {
    return;
  }

  try {
    const snapshot = await gameService.accessGame(req.params.gameId as string, player);

    if (player.kind === "account") {
      await acceptPendingInvitationsForPlayer(snapshot.gameId, player.playerId);
    }

    // When the game is now active (2 players joined), revoke all remaining invites
    if (snapshot.status === "active") {
      void revokeAllPendingInvitationsForGame(snapshot.gameId);
    }

    return res.status(200).json({ snapshot });
  } catch (error) {
    return handleRouteError(res, error, "Unable to open that game right now.", req);
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
router.delete("/games/:gameId", async (req: ExpressRequest, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  if (!isValidGameId(req.params.gameId as string)) {
    return res.status(400).json({ code: "INVALID_GAME_ID", message: "Invalid game ID." });
  }

  try {
    await gameService.cancelWaitingRoom(req.params.gameId as string, player);
    void revokeAllPendingInvitationsForGame(req.params.gameId as string);
    return res.status(204).send();
  } catch (error) {
    return handleRouteError(res, error, "Unable to cancel that game right now.", req);
  }
});

router.get("/games/:gameId", async (req: ExpressRequest, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  if (!isValidGameId(req.params.gameId as string)) {
    return res.status(400).json({ code: "INVALID_GAME_ID", message: "Invalid game ID." });
  }

  try {
    const snapshot = await gameService.getSnapshot(req.params.gameId as string);
    return res.status(200).json({ snapshot });
  } catch (error) {
    return handleRouteError(res, error, "Unable to load that game right now.", req);
  }
});

/**
 * Public endpoint returning minimal game metadata for OpenGraph tags.
 * No authentication required so crawlers / SSR can fetch it.
 */
router.get("/games/:gameId/og", async (req: ExpressRequest, res: Response) => {
  if (!isValidGameId(req.params.gameId as string)) {
    return res.status(400).json({ code: "INVALID_GAME_ID", message: "Invalid game ID." });
  }

  try {
    const room = (await GameRoom.findOne(
      { roomId: (req.params.gameId as string).trim().toUpperCase() },
      {
        status: 1,
        "state.boardSize": 1,
        "state.scoreToWin": 1,
        "state.score": 1,
        "seats.white.displayName": 1,
        "seats.white.playerId": 1,
        "seats.black.displayName": 1,
        "seats.black.playerId": 1,
        timeControl: 1,
        roomType: 1,
      },
    ).lean()) as IGameRoom | null;

    if (!room) {
      return res.status(404).json({ code: "NOT_FOUND", message: "Game not found." });
    }

    // For waiting games, look up the host's ELO
    let whiteRating: number | undefined;
    let blackRating: number | undefined;

    if (room.status === "waiting") {
      const hostId = room.seats?.white?.playerId ?? room.seats?.black?.playerId;
      if (hostId) {
        const hostAccount = await GameAccount.findById(hostId, {
          "rating.overall.elo": 1,
        }).lean();
        const elo = (hostAccount as any)?.rating?.overall?.elo;
        if (room.seats?.white?.playerId === hostId) whiteRating = elo;
        else blackRating = elo;
      }
    }

    return res.status(200).json({
      gameId: (req.params.gameId as string).trim().toUpperCase(),
      status: room.status,
      boardSize: room.state?.boardSize,
      scoreToWin: room.state?.scoreToWin,
      score: room.state?.score,
      white: room.seats?.white?.displayName ?? null,
      black: room.seats?.black?.displayName ?? null,
      whiteRating,
      blackRating,
      timeControl: room.timeControl,
      roomType: room.roomType,
    });
  } catch {
    return res.status(500).json({ code: "INTERNAL_ERROR", message: "Unable to load game info." });
  }
});

// Matchmaking moved to the lobby WebSocket (`/api/ws/lobby`). See
// `LobbyClientMessage` / `LobbyServerMessage` in shared/src/protocol.ts and
// `GameService.enterMatchmakingViaSocket` / `leaveMatchmakingViaSocket`. The
// REST endpoints were removed because they could not detect page-unloads,
// which left ghost queue entries that got matched with real players.

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
router.post("/games/:gameId/cancel-rematch", async (req: ExpressRequest, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) return;

  const gameId = (req.params.gameId as string)?.trim().toUpperCase();
  if (!gameId || !isValidGameId(gameId)) {
    return res.status(400).json({ code: "INVALID_GAME_ID", message: "Invalid game ID." });
  }

  try {
    await gameService.cancelRematchViaRest(gameId, player);
    return res.status(200).json({ message: "Rematch request cancelled." });
  } catch (error) {
    return handleRouteError(res, error, "Unable to cancel rematch request.", req);
  }
});

router.post("/games/:gameId/request-rematch", async (req: ExpressRequest, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) return;

  const gameId = (req.params.gameId as string)?.trim().toUpperCase();
  if (!gameId || !isValidGameId(gameId)) {
    return res.status(400).json({ code: "INVALID_GAME_ID", message: "Invalid game ID." });
  }

  try {
    const result = await gameService.requestRematchViaRest(gameId, player);
    return res.status(200).json(result);
  } catch (error) {
    return handleRouteError(res, error, "Unable to request rematch.", req);
  }
});

router.post("/games/:gameId/decline-rematch", async (req: ExpressRequest, res: Response) => {
  const player = await getAuthenticatedPlayer(req, res);
  if (!player) return;

  const gameId = (req.params.gameId as string)?.trim().toUpperCase();
  if (!gameId || !isValidGameId(gameId)) {
    return res.status(400).json({ code: "INVALID_GAME_ID", message: "Invalid game ID." });
  }

  try {
    await gameService.declineRematchViaRest(gameId, player);
    return res.status(200).json({ message: "Rematch declined." });
  } catch (error) {
    return handleRouteError(res, error, "Unable to decline rematch.", req);
  }
});

router.post("/games/:gameId/test-finish", async (req: ExpressRequest, res: Response) => {
  if (process.env.NODE_ENV !== "test") {
    return res
      .status(403)
      .json({ code: "FORBIDDEN", message: "Only available in test environment." });
  }

  const gameId = req.params.gameId as string;
  const { winner } = req.body as { winner: string };

  if (typeof winner !== "string" || (winner !== "white" && winner !== "black")) {
    return res
      .status(400)
      .json({ code: "VALIDATION_ERROR", message: "Winner must be 'white' or 'black'." });
  }

  try {
    await gameService.testForceFinishGame(gameId, winner);
    res.status(200).json({ message: "Game finished." });
  } catch {
    res.status(500).json({ code: "INTERNAL_ERROR", message: "Failed to finish game." });
  }
});

/**
 * POST /api/test-auth
 * Test-only endpoint: creates an account user and returns session cookies
 * in a single request, bypassing the multi-step browser auth flow.
 * This makes e2e tests fast and deterministic — the real auth flow is
 * tested separately in auth.spec.ts.
 *
 * Internally calls better-auth's signUpEmail API so the session cookie
 * is set in exactly the same format as the real signup flow.
 */
router.post("/test-auth", async (req: ExpressRequest, res: Response) => {
  if (process.env.NODE_ENV !== "test") {
    return res
      .status(403)
      .json({ code: "FORBIDDEN", message: "Only available in test environment." });
  }

  const { username, password, email } = req.body as {
    username: string;
    password: string;
    email?: string;
  };

  if (!username || !password) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "username and password are required.",
    });
  }

  try {
    const { auth: betterAuth } = await import("../auth/auth");
    const testEmail = email || `${username}@test.tiao.local`;

    // Call better-auth's signup as an internal HTTP request so it sets
    // cookies in the exact same format as the real signup flow.
    const origin = `http://localhost:${req.socket.localPort}`;
    const signupResponse = await betterAuth.handler(
      new Request(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin },
        body: JSON.stringify({
          name: username,
          email: testEmail,
          password,
          displayName: username,
        }),
      }),
    );

    if (!signupResponse.ok) {
      const body = await signupResponse.text();
      return res.status(signupResponse.status).json({
        code: "SIGNUP_FAILED",
        message: body,
      });
    }

    // Forward better-auth's Set-Cookie headers to the response
    const setCookies = signupResponse.headers.getSetCookie();
    for (const cookie of setCookies) {
      res.append("Set-Cookie", cookie);
    }

    // Mark the user as having seen the tutorial to skip the rules intro
    const result = (await signupResponse.json()) as { user?: { id?: string } };
    if (result?.user?.id) {
      const GameAccountModel = (await import("../models/GameAccount")).default;
      await GameAccountModel.findByIdAndUpdate(result.user.id, {
        hasSeenTutorial: true,
      });
    }

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: error?.message || "Failed to create test user.",
    });
  }
});

export default router;
