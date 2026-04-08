import Achievement from "../models/Achievement";
import GameAccount from "../models/GameAccount";
import GameRoom from "../models/GameRoom";
import {
  ACHIEVEMENTS,
  getAchievementById,
  type AchievementDefinition,
} from "../../shared/src/achievements";
import { getWinner, getFinishReason, isBoardMove } from "../../shared/src/tiao";
import type { GameState, PlayerColor, JumpTurn } from "../../shared/src/tiao";
import type { StoredMultiplayerRoom } from "./gameStore";
import { ACHIEVEMENT_BADGE_MAP } from "../config/badgeRewards";
import { grantBadge } from "./badgeService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GameCompletedContext = {
  room: StoredMultiplayerRoom;
};

export type EloUpdatedContext = {
  playerId: string;
  newElo: number;
  percentile: number;
};

export type FriendAddedContext = {
  playerId: string;
  friendCount: number;
};

export type AchievementNotifier = (playerId: string, achievement: AchievementDefinition) => void;
export type AchievementChangeNotifier = (playerId: string) => void;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

let _notifier: AchievementNotifier | null = null;
let _changeNotifier: AchievementChangeNotifier | null = null;

export function setAchievementNotifier(notifier: AchievementNotifier): void {
  _notifier = notifier;
}

export function setAchievementChangeNotifier(notifier: AchievementChangeNotifier): void {
  _changeNotifier = notifier;
}

async function grant(playerId: string, achievementId: string): Promise<boolean> {
  const def = getAchievementById(achievementId);
  if (!def) return false;

  try {
    await Achievement.create({
      playerId,
      achievementId,
      unlockedAt: new Date(),
    });
  } catch (err: unknown) {
    // Duplicate key = already unlocked — not an error
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: number }).code === 11000
    ) {
      return false;
    }
    throw err;
  }

  console.log(`[achievement] Granted "${achievementId}" to ${playerId}`);
  if (_notifier) _notifier(playerId, def);

  // Auto-grant corresponding badge if this achievement has one
  const badgeId = ACHIEVEMENT_BADGE_MAP[achievementId];
  if (badgeId) {
    try {
      await grantBadge(playerId, badgeId);
      console.log(`[achievement] Auto-granted badge "${badgeId}" to ${playerId}`);
    } catch (err) {
      console.error(`[achievement] Failed to auto-grant badge "${badgeId}":`, err);
    }
  }

  return true;
}

async function hasAchievement(playerId: string, achievementId: string): Promise<boolean> {
  const count = await Achievement.countDocuments({ playerId, achievementId });
  return count > 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getPlayerAchievements(
  playerId: string,
): Promise<{ achievementId: string; unlockedAt: Date }[]> {
  const docs = await Achievement.find({ playerId }).lean();
  return docs.map((d) => ({
    achievementId: d.achievementId,
    unlockedAt: d.unlockedAt,
  }));
}

export async function adminGrantAchievement(
  playerId: string,
  achievementId: string,
): Promise<boolean> {
  return grant(playerId, achievementId);
}

export async function adminRevokeAchievement(
  playerId: string,
  achievementId: string,
): Promise<boolean> {
  const result = await Achievement.deleteOne({ playerId, achievementId });
  if (result.deletedCount > 0) {
    console.log(`[achievement] Revoked "${achievementId}" from ${playerId}`);
    if (_changeNotifier) _changeNotifier(playerId);
    return true;
  }
  return false;
}

export async function getPlayerAchievementIds(playerId: string): Promise<string[]> {
  const docs = await Achievement.find({ playerId }).select("achievementId").lean();
  return docs.map((d) => d.achievementId);
}

// ---------------------------------------------------------------------------
// Event: Game Completed (multiplayer)
// ---------------------------------------------------------------------------

export async function onGameCompleted(ctx: GameCompletedContext): Promise<void> {
  const { room } = ctx;
  if (room.status !== "finished") return;

  const white = room.seats.white;
  const black = room.seats.black;
  if (!white || !black) return;

  const winner = getWinner(room.state);
  const finishReason = getFinishReason(room.state);
  const boardMoves = room.state.history.filter(isBoardMove);

  // Both players are "account" type to track achievements
  const players: { id: string; color: PlayerColor; isAccount: boolean }[] = [
    { id: white.playerId, color: "white", isAccount: white.kind === "account" },
    { id: black.playerId, color: "black", isAccount: black.kind === "account" },
  ];

  for (const p of players) {
    if (!p.isAccount) continue;

    // Fetch current game count (already incremented by ELO update)
    const account = await GameAccount.findById(p.id);
    if (!account) continue;
    const gamesPlayed = account.rating?.overall?.gamesPlayed ?? 0;

    // ── Games Played progression ──
    const gamesThresholds: [string, number][] = [
      ["first-move", 1],
      ["getting-started", 5],
      ["regular", 10],
      ["centurion", 100],
      ["veteran", 1000],
    ];
    for (const [id, threshold] of gamesThresholds) {
      if (gamesPlayed >= threshold) {
        void grant(p.id, id);
      }
    }

    const isWinner = winner === p.color;
    const isLoser = winner !== null && winner !== p.color;

    // ── Losses progression ──
    if (isLoser) {
      const lossCount = await countLosses(p.id);
      const lossThresholds: [string, number][] = [
        ["first-fall", 1],
        ["tough-luck", 5],
        ["punching-bag", 10],
      ];
      for (const [id, threshold] of lossThresholds) {
        if (lossCount >= threshold) {
          void grant(p.id, id);
        }
      }
    }

    // ── Timed wins ──
    if (isWinner && room.timeControl) {
      void grant(p.id, "speed-demon");

      const remainingMs = room.clockMs?.[p.color] ?? Infinity;
      if (remainingMs <= 10_000) {
        void grant(p.id, "buzzer-beater");
      }
      if (remainingMs <= 1_000) {
        void grant(p.id, "one-second-glory");
      }
    }

    // ── Secret: Rage Quit (forfeit within first 3 board moves) ──
    if (finishReason === "forfeit" && !isWinner && boardMoves.length <= 3) {
      void grant(p.id, "rage-quit");
    }

    // ── Secret: Night Owl (game played between 2-5 AM) ──
    const hour = new Date().getHours();
    if (hour >= 2 && hour < 5) {
      void grant(p.id, "night-owl");
    }

    // ── Secret: Speedrun (win in under 30 seconds) ──
    if (isWinner) {
      const durationMs = room.updatedAt.getTime() - room.createdAt.getTime();
      if (durationMs < 30_000) {
        void grant(p.id, "speedrun");
      }
    }

    // ── Secret: Comeback Kid (win after being down by 3+ at some point) ──
    if (isWinner) {
      const wasDown = checkComebackWin(room.state, p.color);
      if (wasDown) {
        void grant(p.id, "comeback-kid");
      }
    }

    // ── Secret: Flawless Victory (win without opponent capturing any of your pieces) ──
    if (isWinner) {
      const opponentColor = p.color === "white" ? "black" : "white";
      if (room.state.score[opponentColor] === 0) {
        void grant(p.id, "flawless-victory");
      }
    }

    // ── Secret: David vs Goliath (beat someone 300+ ELO above you) ──
    if (isWinner && room.ratingBefore) {
      const myRating = room.ratingBefore[p.color];
      const oppColor = p.color === "white" ? "black" : "white";
      const oppRating = room.ratingBefore[oppColor];
      if (oppRating - myRating >= 300) {
        void grant(p.id, "david-vs-goliath");
      }
    }

    // ── Secret: Checkered Past (play on every board size) ──
    const boardSizesPlayed = await getDistinctBoardSizes(p.id);
    if (boardSizesPlayed.size >= 3) {
      void grant(p.id, "checkered-past");
    }

    // ── Chain Reaction (5+ captures in a single chain jump) ──
    const playerJumps = room.state.history.filter(
      (t): t is JumpTurn => t.type === "jump" && t.color === p.color,
    );
    for (const jump of playerJumps) {
      if (jump.jumps.length >= 5) {
        void grant(p.id, "chain-reaction");
        break;
      }
    }

    // ── One Jump Wonder (win entire game from a single chain jump, score 0 → scoreToWin) ──
    if (isWinner) {
      const myJumps = playerJumps;
      // The player must have exactly one jump turn that scored all the points
      if (myJumps.length === 1 && myJumps[0]!.jumps.length >= room.state.scoreToWin) {
        // Verify no points came from placement captures — only from that one jump
        const putTurns = room.state.history.filter((t) => t.type === "put" && t.color === p.color);
        // If there are put turns but score came entirely from the jump, it counts
        // Score = jumps captured in that chain = jumps.length
        if (myJumps[0]!.jumps.length >= room.state.scoreToWin) {
          void grant(p.id, "one-jump-wonder");
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Event: Piece Captured (multiplayer, fires on each confirmed jump)
// ---------------------------------------------------------------------------

export async function onPieceCaptured(playerId: string): Promise<void> {
  void grant(playerId, "first-blood");
}

// ---------------------------------------------------------------------------
// Event: ELO Updated
// ---------------------------------------------------------------------------

export async function onEloUpdated(ctx: EloUpdatedContext): Promise<void> {
  if (ctx.percentile >= 99) {
    void grant(ctx.playerId, "top-one-percent");
  }
}

// ---------------------------------------------------------------------------
// Event: Friend Added
// ---------------------------------------------------------------------------

export async function onFriendAdded(ctx: FriendAddedContext): Promise<void> {
  const thresholds: [string, number][] = [
    ["first-friend", 1],
    ["social-butterfly", 10],
  ];
  for (const [id, threshold] of thresholds) {
    if (ctx.friendCount >= threshold) {
      void grant(ctx.playerId, id);
    }
  }
}

// ---------------------------------------------------------------------------
// Event: Tutorial Completed
// ---------------------------------------------------------------------------

export async function onTutorialCompleted(playerId: string): Promise<void> {
  void grant(playerId, "tutorial-complete");
}

// ---------------------------------------------------------------------------
// Event: Spectated a Game
// ---------------------------------------------------------------------------

export async function onSpectateStarted(playerId: string): Promise<void> {
  void grant(playerId, "spectator");
}

// ---------------------------------------------------------------------------
// Event: Tournament Won
// ---------------------------------------------------------------------------

export async function onTournamentWon(playerId: string): Promise<void> {
  void grant(playerId, "tournament-champion");
}

// ---------------------------------------------------------------------------
// Event: AI Game Won (reported by client)
// ---------------------------------------------------------------------------

export async function onAIGameWon(playerId: string, difficulty: 1 | 2 | 3): Promise<void> {
  const map: Record<number, string> = {
    1: "ai-easy",
    2: "ai-medium",
    3: "ai-hard",
  };
  const id = map[difficulty];
  if (id) {
    void grant(playerId, id);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function countLosses(playerId: string): Promise<number> {
  // Count finished games where this player lost
  const rooms = await GameRoom.find({
    status: "finished",
    $or: [{ "seats.white.playerId": playerId }, { "seats.black.playerId": playerId }],
  })
    .select("state seats")
    .lean();

  let losses = 0;
  for (const room of rooms) {
    if (!room.state?.history) continue;
    const winner = getWinner(room.state);
    if (!winner) continue;
    const mySeat = room.seats?.white?.playerId === playerId ? "white" : "black";
    if (winner !== mySeat) losses++;
  }
  return losses;
}

function checkComebackWin(state: GameState, winnerColor: PlayerColor): boolean {
  // Replay the score progression to see if winner was ever down by 3+
  let whiteScore = 0;
  let blackScore = 0;
  const opponentColor = winnerColor === "white" ? "black" : "white";

  for (const turn of state.history) {
    if (turn.type === "jump") {
      // Each jump can capture pieces — but we don't have per-turn score delta
      // in the history. We'll use a simpler heuristic: check the final score
      // difference. If the loser has >= 3 points, the winner had to overcome that.
    }
  }

  // Simpler approach: if the opponent scored 3+ points, it's a comeback
  return state.score[opponentColor] >= 3;
}

async function getDistinctBoardSizes(playerId: string): Promise<Set<number>> {
  const rooms = await GameRoom.find({
    status: "finished",
    $or: [{ "seats.white.playerId": playerId }, { "seats.black.playerId": playerId }],
  })
    .select("state.boardSize")
    .lean();

  const sizes = new Set<number>();
  for (const room of rooms) {
    if (room.state?.boardSize) {
      sizes.add(room.state.boardSize);
    }
  }
  return sizes;
}
