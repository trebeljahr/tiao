import { escapeRegExp } from "../error-handling/escapeRegExp";
import { tournamentService } from "../game/tournamentService";
import GameAccount from "../models/GameAccount";
import GameRoom, { type IGameRoom } from "../models/GameRoom";

/**
 * Public data behind link previews: the `og` JSON endpoint of a game, and
 * the per-link images rendered by `routes/previewImage.routes.ts`. No
 * authentication, so nothing here may reveal more than those pages show a
 * signed-out visitor.
 */

const GAME_ID_PATTERN = /^[A-Z2-9]{6}$/;

export function isValidGameId(gameId: string): boolean {
  return GAME_ID_PATTERN.test(gameId.trim().toUpperCase());
}

export type GamePreview = {
  gameId: string;
  status: string;
  boardSize?: number;
  scoreToWin?: number;
  score?: { white: number; black: number };
  white: string | null;
  black: string | null;
  whiteRating?: number;
  blackRating?: number;
  timeControl: IGameRoom["timeControl"];
  roomType: IGameRoom["roomType"];
};

/** A game's preview data, or null when there is no such game. */
export async function loadGamePreview(rawGameId: string): Promise<GamePreview | null> {
  const gameId = rawGameId.trim().toUpperCase();
  const room = (await GameRoom.findOne(
    { roomId: gameId },
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
  if (!room) return null;

  // For waiting games, look up the host's ELO
  let whiteRating: number | undefined;
  let blackRating: number | undefined;
  if (room.status === "waiting") {
    const hostId = room.seats?.white?.playerId ?? room.seats?.black?.playerId;
    if (hostId) {
      const hostAccount = await GameAccount.findById(hostId, {
        "rating.overall.elo": 1,
      }).lean();
      const elo = (hostAccount as { rating?: { overall?: { elo?: number } } } | null)?.rating
        ?.overall?.elo;
      if (room.seats?.white?.playerId === hostId) whiteRating = elo;
      else blackRating = elo;
    }
  }

  return {
    gameId,
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
  };
}

export type ProfilePreview = { displayName: string; rating?: number; gamesPlayed?: number };

/** A player's preview data by account id or display name, or null. */
export async function loadProfilePreview(username: string): Promise<ProfilePreview | null> {
  const name = username.trim().toLowerCase();
  if (!name || name.length > 64) return null;
  const projection = { displayName: 1, "rating.overall": 1 };
  type Found = {
    displayName: string;
    rating?: { overall?: { elo?: number; gamesPlayed?: number } };
  } | null;
  let account = (
    /^[0-9a-f]{24}$/.test(name) ? await GameAccount.findById(name, projection).lean() : null
  ) as Found;
  if (!account) {
    account = (await GameAccount.findOne(
      { displayName: { $regex: new RegExp(`^${escapeRegExp(name)}$`, "i") } },
      projection,
    ).lean()) as Found;
  }
  if (!account) return null;
  const overall = account.rating?.overall;
  return {
    displayName: account.displayName,
    rating: overall?.gamesPlayed ? overall.elo : undefined,
    gamesPlayed: overall?.gamesPlayed,
  };
}

export type TournamentPreview = { name: string; format: string; playerCount: number };

/** A public tournament's preview data, or null (also for private ones). */
export async function loadTournamentPreview(id: string): Promise<TournamentPreview | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  try {
    const snapshot = await tournamentService.getTournamentSnapshot(id);
    if (snapshot.settings.visibility === "private") return null;
    return {
      name: snapshot.name,
      format: snapshot.settings.format,
      playerCount: snapshot.participants.length,
    };
  } catch {
    return null;
  }
}
