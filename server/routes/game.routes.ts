import express, { Request, Response } from "express";
import { gameService, GameServiceError } from "../game/gameService";
import { getPlayerFromRequest } from "../game/playerTokens";

const router = express.Router();

function getAuthenticatedPlayer(req: Request, res: Response) {
  const player = getPlayerFromRequest(req);
  if (!player) {
    res.status(401).json({
      message: "Authenticate as a guest or account before creating a game.",
    });
    return null;
  }

  return player;
}

router.post("/games", (req: Request, res: Response) => {
  const player = getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  const snapshot = gameService.createGame(player);
  res.status(201).json({ snapshot });
});

router.post("/games/:gameId/join", (req: Request, res: Response) => {
  const player = getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  try {
    const snapshot = gameService.joinGame(req.params.gameId, player);
    res.status(200).json({ snapshot });
  } catch (error) {
    if (error instanceof GameServiceError) {
      return res.status(error.status).json({
        code: error.code,
        message: error.message,
      });
    }

    return res.status(500).json({
      message: "Unable to join that game right now.",
    });
  }
});

router.get("/games/:gameId", (req: Request, res: Response) => {
  const player = getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  try {
    const snapshot = gameService.getSnapshot(req.params.gameId);
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
    if (error instanceof GameServiceError) {
      return res.status(error.status).json({
        code: error.code,
        message: error.message,
      });
    }

    return res.status(500).json({
      message: "Unable to load that game right now.",
    });
  }
});

router.post("/games/:gameId/reset", (req: Request, res: Response) => {
  const player = getAuthenticatedPlayer(req, res);
  if (!player) {
    return;
  }

  try {
    const snapshot = gameService.resetGame(req.params.gameId, player);
    return res.status(200).json({ snapshot });
  } catch (error) {
    if (error instanceof GameServiceError) {
      return res.status(error.status).json({
        code: error.code,
        message: error.message,
      });
    }

    return res.status(500).json({
      message: "Unable to restart that game right now.",
    });
  }
});

export default router;
