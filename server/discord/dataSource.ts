import GameAccount from "../models/GameAccount";
import GameRoom from "../models/GameRoom";
import type { DiscordDataSource, PlayerStats } from "./commands";
import { fetchTopPlayersFromDb } from "./leaderboardJob";
import { loadPuzzleFromFile } from "./puzzle";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface RatingPair {
  white: number;
  black: number;
}

interface AccountSlice {
  _id: unknown;
  displayName: string;
  rating?: { overall?: { elo?: number; gamesPlayed?: number } };
}

interface FinishedGameSlice {
  seats?: { white?: { playerId?: string }; black?: { playerId?: string } };
  state?: { score?: RatingPair; scoreToWin?: number };
  ratingBefore?: RatingPair | null;
  ratingAfter?: RatingPair | null;
}

/**
 * Count wins/losses the same way the public profile endpoint does: rating
 * delta when the game was rated, score comparison otherwise. Kept local so
 * the bot has no coupling to the HTTP profile route.
 */
export function tallyResults(games: FinishedGameSlice[], playerId: string) {
  let gamesWon = 0;
  let gamesLost = 0;
  for (const game of games) {
    const isWhite = game.seats?.white?.playerId === playerId;
    const isBlack = game.seats?.black?.playerId === playerId;
    if (!isWhite && !isBlack) continue;
    const mySeat: keyof RatingPair = isWhite ? "white" : "black";
    const theirSeat: keyof RatingPair = isWhite ? "black" : "white";

    if (game.ratingBefore && game.ratingAfter) {
      if (game.ratingAfter[mySeat] > game.ratingBefore[mySeat]) gamesWon++;
      else gamesLost++;
      continue;
    }

    const score = game.state?.score;
    const scoreToWin = game.state?.scoreToWin;
    if (score && scoreToWin) {
      if (score[mySeat] >= scoreToWin || score[mySeat] > score[theirSeat]) gamesWon++;
      else gamesLost++;
    }
  }
  return { gamesWon, gamesLost };
}

export function createMongoDataSource(options: { puzzleFile?: string }): DiscordDataSource {
  return {
    // Same query and ordering as the daily pinned leaderboard message.
    topPlayers: fetchTopPlayersFromDb,

    async findPlayerStats(username: string): Promise<PlayerStats | null> {
      const account = (await GameAccount.findOne(
        { displayName: { $regex: new RegExp(`^${escapeRegex(username)}$`, "i") } },
        { displayName: 1, "rating.overall": 1 },
      ).lean()) as unknown as AccountSlice | null;
      if (!account) return null;

      const playerId = String(account._id);
      const elo = Math.round(account.rating?.overall?.elo ?? 1500);
      const gamesPlayed = account.rating?.overall?.gamesPlayed ?? 0;

      let gamesWon = 0;
      let gamesLost = 0;
      if (gamesPlayed > 0) {
        const finished = (await GameRoom.find(
          {
            status: "finished",
            $or: [{ "seats.white.playerId": playerId }, { "seats.black.playerId": playerId }],
          },
          {
            "seats.white.playerId": 1,
            "seats.black.playerId": 1,
            "state.score": 1,
            "state.scoreToWin": 1,
            ratingBefore: 1,
            ratingAfter: 1,
          },
        )
          .lean()
          .limit(1000)) as FinishedGameSlice[];
        ({ gamesWon, gamesLost } = tallyResults(finished, playerId));
      }

      const decided = gamesWon + gamesLost;
      return {
        displayName: account.displayName,
        elo,
        gamesPlayed: decided > 0 ? decided : gamesPlayed,
        gamesWon,
        gamesLost,
      };
    },

    currentPuzzle() {
      return loadPuzzleFromFile(options.puzzleFile);
    },
  };
}
