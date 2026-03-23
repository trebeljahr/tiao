import express, { Request, Response } from "express";
import { gameService, GameServiceError } from "../game/gameService";
import { getPlayerFromRequest } from "../game/playerTokens";

const router = express.Router();

function getAuthenticatedPlayer(req: Request, res: Response) {
  const player = getPlayerFromRequest(req);
  if (!player) {
    res.status(401).json({
      message: "Authenticate as a guest or account before using multiplayer.",
    });
    return null;
  }

  return player;
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

  return res.status(500).json({
    message: fallbackMessage,
  });
}

router.get("/games", async (req: Request, res: Response) => {
  const player = getAuthenticatedPlayer(req, res);
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

router.post("/games", async (req: Request, res: Response) => {
  const player = getAuthenticatedPlayer(req, res);
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

router.post("/games/:gameId/join", async (req: Request, res: Response) => {
  const player = getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  try {
    const snapshot = await gameService.joinGame(req.params.gameId, player);
    return res.status(200).json({ snapshot });
  } catch (error) {
    return respondWithGameServiceError(
      res,
      error,
      "Unable to join that game right now."
    );
  }
});

router.get("/games/:gameId", async (req: Request, res: Response) => {
  const player = getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  try {
    const snapshot = await gameService.getSnapshot(req.params.gameId);
    const participatingPlayer =
      snapshot.seats.white?.player.playerId === player.playerId ||
      snapshot.seats.black?.player.playerId === player.playerId;

    if (!participatingPlayer) {
      return res.status(403).json({
        message: "You are not seated in that game.",
      });
    }

    return res.status(200).json({ snapshot });
  } catch (error) {
    return respondWithGameServiceError(
      res,
      error,
      "Unable to load that game right now."
    );
  }
});

router.post("/games/:gameId/reset", async (req: Request, res: Response) => {
  const player = getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  try {
    const snapshot = await gameService.resetGame(req.params.gameId, player);
    return res.status(200).json({ snapshot });
  } catch (error) {
    return respondWithGameServiceError(
      res,
      error,
      "Unable to restart that game right now."
    );
  }
});

export default router;
