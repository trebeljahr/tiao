import { isValidObjectId } from "mongoose";
import type { PlayerIdentity } from "../../shared/src";
import GameAccount from "../models/GameAccount";
import { getRedisClient } from "../config/redisClient";

/**
 * Cached subset of player identity that can be resolved from GameAccount.
 * Fields like `kind`, `email`, `hasSeenTutorial`, `isAdmin`, `needsUsername`
 * are NOT cached — they come from the session or stored seat data.
 */
export type CachedPlayerProfile = {
  displayName: string;
  profilePicture?: string;
  rating?: number;
  badges?: string[];
  activeBadges?: string[];
};

const REDIS_PREFIX = "pid:";
const REDIS_TTL_SECONDS = 300; // 5 minutes

// In-memory fallback when Redis is unavailable (tests, local dev without Redis)
const memCache = new Map<string, { profile: CachedPlayerProfile; expiresAt: number }>();
const MEM_TTL_MS = 5 * 60 * 1000;

function redisKey(playerId: string): string {
  return `${REDIS_PREFIX}${playerId}`;
}

function profileFromAccount(account: {
  displayName: string;
  profilePicture?: string;
  rating?: { overall?: { elo?: number } };
  badges?: string[];
  activeBadges?: string[];
}): CachedPlayerProfile {
  return {
    displayName: account.displayName,
    profilePicture: account.profilePicture || undefined,
    rating: account.rating?.overall?.elo,
    badges: account.badges,
    activeBadges: account.activeBadges,
  };
}

async function fetchFromDb(playerId: string): Promise<CachedPlayerProfile | null> {
  if (!isValidObjectId(playerId)) return null;
  try {
    const account = (await GameAccount.findById(playerId, {
      displayName: 1,
      profilePicture: 1,
      "rating.overall.elo": 1,
      badges: 1,
      activeBadges: 1,
    }).lean()) as {
      displayName: string;
      profilePicture?: string;
      rating?: { overall?: { elo?: number } };
      badges?: string[];
      activeBadges?: string[];
    } | null;
    if (!account) return null;
    return profileFromAccount(account);
  } catch {
    return null;
  }
}

async function getFromRedis(playerId: string): Promise<CachedPlayerProfile | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(redisKey(playerId));
    if (!raw) return null;
    return JSON.parse(raw) as CachedPlayerProfile;
  } catch {
    return null;
  }
}

async function setInRedis(playerId: string, profile: CachedPlayerProfile): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.set(redisKey(playerId), JSON.stringify(profile), "EX", REDIS_TTL_SECONDS);
  } catch {
    // Best-effort cache write
  }
}

function getFromMem(playerId: string): CachedPlayerProfile | null {
  const entry = memCache.get(playerId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memCache.delete(playerId);
    return null;
  }
  return entry.profile;
}

function setInMem(playerId: string, profile: CachedPlayerProfile): void {
  memCache.set(playerId, { profile, expiresAt: Date.now() + MEM_TTL_MS });
}

/**
 * Get a player's cached profile (displayName, profilePicture, rating, badges).
 * Returns null for guest players (non-ObjectId) or deleted accounts.
 */
export async function getPlayerProfile(playerId: string): Promise<CachedPlayerProfile | null> {
  if (!isValidObjectId(playerId)) return null;

  // Try Redis first
  const cached = (await getFromRedis(playerId)) ?? getFromMem(playerId);
  if (cached) return cached;

  // Cache miss — fetch from DB
  const profile = await fetchFromDb(playerId);
  if (profile) {
    setInMem(playerId, profile);
    void setInRedis(playerId, profile);
  }
  return profile;
}

/**
 * Batch-fetch player profiles. Returns a map of playerId → CachedPlayerProfile.
 * Guest/invalid IDs are silently skipped.
 */
export async function getPlayerProfiles(
  playerIds: string[],
): Promise<Map<string, CachedPlayerProfile>> {
  const result = new Map<string, CachedPlayerProfile>();
  const missing: string[] = [];

  for (const id of playerIds) {
    if (!isValidObjectId(id)) continue;

    // Try cache first
    const cached = (await getFromRedis(id)) ?? getFromMem(id);
    if (cached) {
      result.set(id, cached);
    } else {
      missing.push(id);
    }
  }

  if (missing.length > 0) {
    try {
      const accounts = (await GameAccount.find(
        { _id: { $in: missing } },
        { displayName: 1, profilePicture: 1, "rating.overall.elo": 1, badges: 1, activeBadges: 1 },
      ).lean()) as Array<{
        _id: unknown;
        displayName: string;
        profilePicture?: string;
        rating?: { overall?: { elo?: number } };
        badges?: string[];
        activeBadges?: string[];
      }>;

      for (const account of accounts) {
        const id = String(account._id);
        const profile = profileFromAccount(account);
        result.set(id, profile);
        setInMem(id, profile);
        void setInRedis(id, profile);
      }
    } catch {
      // Graceful fallback — return whatever we have from cache
    }
  }

  return result;
}

/**
 * Invalidate a player's cached profile. Call after profile updates.
 */
export function invalidatePlayerProfile(playerId: string): void {
  memCache.delete(playerId);
  const redis = getRedisClient();
  if (redis) {
    void redis.del(redisKey(playerId)).catch(() => {});
  }
}

/**
 * Merge a stored slim identity (playerId + kind + displayName) with cached profile data.
 * Returns a full PlayerIdentity suitable for sending to clients.
 */
export function enrichIdentity(
  stored: { playerId: string; kind: "guest" | "account"; displayName: string },
  profile: CachedPlayerProfile | null,
): PlayerIdentity {
  if (!profile) {
    return {
      playerId: stored.playerId,
      displayName: stored.displayName,
      kind: stored.kind,
    };
  }

  return {
    playerId: stored.playerId,
    displayName: profile.displayName,
    kind: stored.kind,
    profilePicture: profile.profilePicture,
    rating: profile.rating,
    badges: profile.badges,
    activeBadges: profile.activeBadges,
  };
}

/** Clear all in-memory cache entries (for tests). */
export function clearCache(): void {
  memCache.clear();
}
