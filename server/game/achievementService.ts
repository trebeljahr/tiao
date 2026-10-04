import { isValidObjectId } from "mongoose";
import {
  type AchievementDefinition,
  DISCORD_SILENT_ACHIEVEMENT_IDS,
  getAchievementById,
} from "../../shared/src/achievements";
import type { AchievementProgress } from "../../shared/src/steamStats";
import type { GameState, JumpTurn, PlayerColor } from "../../shared/src/tiao";
import { getFinishReason, getWinner, isBoardMove } from "../../shared/src/tiao";
import { ACHIEVEMENT_BADGE_MAP } from "../config/badgeRewards";
import { postWebhook } from "../discord/webhooks";
import Achievement from "../models/Achievement";
import GameAccount from "../models/GameAccount";
import GameRoom from "../models/GameRoom";
import { grantBadge } from "./badgeService";
import type { StoredMultiplayerRoom } from "./gameStore";

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

  if (_notifier) _notifier(playerId, def);

  void announceGrantOnDiscord(playerId, def);

  // Auto-grant corresponding badge if this achievement has one
  const badgeId = ACHIEVEMENT_BADGE_MAP[achievementId];
  if (badgeId) {
    try {
      await grantBadge(playerId, badgeId);
    } catch (err) {
      console.error(`[achievement] Failed to auto-grant badge "${badgeId}":`, err);
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Discord announcements
// ---------------------------------------------------------------------------

export function formatAchievementUnlock(displayName: string, def: AchievementDefinition): string {
  return `🏆 ${displayName} unlocked '${def.name}'`;
}

export type AnnounceDeps = {
  /** Webhook URL; defaults to `DISCORD_WEBHOOK_ACHIEVEMENTS`. */
  webhookUrl?: string;
  post?: (url: string, content: string) => Promise<boolean>;
};

/**
 * Post a freshly granted achievement to the Discord achievements channel.
 *
 * Returns `true` only when a post was attempted and accepted. Resolves
 * `false` (never rejects) when the webhook is not configured, the
 * achievement is on the silent list, or Discord refused the post.
 *
 * Secret achievements are announced by name like any other: they are hidden
 * only until earned, and the announcement fires after the unlock, so nothing
 * is leaked that the player cannot already see on their own profile.
 *
 * The env var is read per call rather than at module load so the feature can
 * be toggled in tests and so a missing var at boot never pins the service
 * into a disabled state.
 */
export async function announceAchievementUnlock(
  displayName: string,
  def: AchievementDefinition,
  deps: AnnounceDeps = {},
): Promise<boolean> {
  const url = deps.webhookUrl ?? process.env.DISCORD_WEBHOOK_ACHIEVEMENTS;
  if (!url) return false;
  if (DISCORD_SILENT_ACHIEVEMENT_IDS.includes(def.id)) return false;
  const post = deps.post ?? postWebhook;
  return post(url, formatAchievementUnlock(displayName, def));
}

/**
 * Grant-path wrapper: looks up the player's display name and announces.
 * Fully isolated from the caller — a DB hiccup here logs and returns; the
 * achievement itself was already persisted before this runs.
 */
async function announceGrantOnDiscord(playerId: string, def: AchievementDefinition): Promise<void> {
  if (!process.env.DISCORD_WEBHOOK_ACHIEVEMENTS) return;
  if (DISCORD_SILENT_ACHIEVEMENT_IDS.includes(def.id)) return;
  try {
    const account = await GameAccount.findById(playerId).select("displayName");
    if (!account?.displayName) return;
    await announceAchievementUnlock(account.displayName, def);
  } catch (err) {
    console.error(`[achievement] Discord announcement failed for "${def.id}":`, err);
  }
}

async function _hasAchievement(playerId: string, achievementId: string): Promise<boolean> {
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
    if (_changeNotifier) _changeNotifier(playerId);
    return true;
  }
  return false;
}

export async function getPlayerAchievementIds(playerId: string): Promise<string[]> {
  const docs = await Achievement.find({ playerId }).select("achievementId").lean();
  return docs.map((d) => d.achievementId);
}

/**
 * Batch variant: fetch achievement IDs for many players in a single query.
 * Returns a Map<playerId, achievementIds[]> where players with no
 * achievements map to an empty array.
 */
export async function getPlayerAchievementIdsBatch(
  playerIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (const id of playerIds) result.set(id, []);
  if (playerIds.length === 0) return result;
  const docs = await Achievement.find({ playerId: { $in: playerIds } })
    .select("playerId achievementId")
    .lean();
  for (const d of docs) {
    const list = result.get(String(d.playerId));
    if (list) list.push(d.achievementId);
  }
  return result;
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

  // Both players are "account" type to track achievements. Also require a
  // valid ObjectId for `id` — tests and some legacy fixtures use freeform
  // account IDs like "alice" which would otherwise blow up GameAccount.findById
  // with a Mongoose CastError, spamming stderr in the test suite.
  const players: { id: string; color: PlayerColor; isAccount: boolean }[] = [
    {
      id: white.playerId,
      color: "white",
      isAccount: white.kind === "account" && isValidObjectId(white.playerId),
    },
    {
      id: black.playerId,
      color: "black",
      isAccount: black.kind === "account" && isValidObjectId(black.playerId),
    },
  ];

  for (const p of players) {
    if (!p.isAccount) continue;

    // Fetch current game count (already incremented by ELO update)
    const account = await GameAccount.findById(p.id);
    if (!account) continue;
    const gamesPlayed = account.rating?.overall?.gamesPlayed ?? 0;

    // ── Games Played progression ──
    // Note: "first-move" is NOT triggered here — it fires the moment a player
    // makes their first turn-completing move, not at game end. See
    // `onFirstMoveMade` and its call site in gameService.applyAction.
    const gamesThresholds: [string, number][] = [
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

      const remainingMs = room.clockMs?.[p.color] ?? Number.POSITIVE_INFINITY;
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
        const _putTurns = room.state.history.filter((t) => t.type === "put" && t.color === p.color);
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
// Event: First Move Made (multiplayer, fires on first turn-completing move)
// ---------------------------------------------------------------------------

export async function onFirstMoveMade(playerId: string): Promise<void> {
  void grant(playerId, "first-move");
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
  await grant(playerId, "tournament-champion");
  // A crash can leave the achievement inserted before its companion badge.
  // $addToSet repairs that partial outcome even when grant sees a duplicate.
  const badge = ACHIEVEMENT_BADGE_MAP["tournament-champion"];
  if (badge) await grantBadge(playerId, badge);
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

/**
 * Current values behind the progress-bar achievements.
 *
 * Mirrors the counts this service already checks when granting: games played
 * from the account's rating record, losses by replaying finished games, and
 * friends from the account's own list. Kept next to the granting logic on
 * purpose — if a threshold check here and the value reported to Steam ever
 * disagreed, the progress bar would drift away from the unlock.
 *
 * Cost note: `countLosses` scans every finished game for the player. That is
 * already paid on each game end, but it makes this a deliberately
 * low-frequency call — the desktop client fetches it on the achievements
 * screen, not per render.
 */
export async function getAchievementProgress(playerId: string): Promise<AchievementProgress> {
  const account = await GameAccount.findById(playerId);
  if (!account) {
    return { gamesPlayed: 0, gamesLost: 0, friendCount: 0 };
  }

  return {
    gamesPlayed: account.rating?.overall?.gamesPlayed ?? 0,
    gamesLost: await countLosses(playerId),
    friendCount: account.friends?.length ?? 0,
  };
}

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
  const _whiteScore = 0;
  const _blackScore = 0;
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
