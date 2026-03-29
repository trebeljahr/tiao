/**
 * Test helper for mocking better-auth sessions in unit tests.
 *
 * Since unit tests invoke Express route handlers directly (not via HTTP),
 * they can't go through better-auth's cookie-based session flow.
 * This module patches `getPlayerFromRequest` to return predictable
 * PlayerIdentity values based on a test cookie header.
 */

import { randomUUID } from "crypto";
import type { PlayerIdentity } from "../../shared/src";

const testSessions = new Map<string, PlayerIdentity>();

/**
 * Create a test guest session and return a mock cookie string.
 * Pass this cookie in the `cookie` field of `invokeRoute` options.
 */
export function createTestGuest(displayName: string): {
  player: PlayerIdentity;
  cookie: string;
} {
  const playerId = `test-guest-${randomUUID()}`;
  const cookieValue = `tiao.test_session=${playerId}`;

  const player: PlayerIdentity = {
    playerId,
    displayName,
    kind: "guest",
  };

  testSessions.set(playerId, player);

  return { player, cookie: cookieValue };
}

/**
 * Create a test account session and return a mock cookie string.
 */
export function createTestAccount(
  displayName: string,
  email?: string,
  options?: { badges?: string[]; activeBadges?: string[]; isAdmin?: boolean },
): {
  player: PlayerIdentity;
  cookie: string;
} {
  const playerId = `test-account-${randomUUID()}`;
  const cookieValue = `tiao.test_session=${playerId}`;

  const player: PlayerIdentity = {
    playerId,
    displayName,
    kind: "account",
    email,
    badges: options?.badges ?? [],
    activeBadges: options?.activeBadges ?? [],
    isAdmin: options?.isAdmin,
  };

  testSessions.set(playerId, player);

  return { player, cookie: cookieValue };
}

/**
 * Look up a test session by parsing the mock cookie.
 * Used by the patched `getPlayerFromRequest`.
 */
export function getTestSession(cookieHeader?: string): PlayerIdentity | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith("tiao.test_session=")) {
      const playerId = trimmed.split("=")[1];
      return testSessions.get(playerId!) ?? null;
    }
  }

  return null;
}

/**
 * Clear all test sessions (call in beforeEach/afterEach).
 */
export function resetTestSessions(): void {
  testSessions.clear();
}

/**
 * Install the test session mock on the sessionHelper module.
 * Call this in beforeEach after importing sessionHelper.
 */
export async function installTestSessionMock(): Promise<void> {
  const sessionHelper = await import("../auth/sessionHelper");
  const mod = sessionHelper as Record<string, unknown>;

  mod.getPlayerFromRequest = async (req: { headers: { cookie?: string } }) => {
    return getTestSession(req.headers.cookie);
  };

  mod.getPlayerFromUpgradeRequest = async (req: { headers: { cookie?: string } }) => {
    return getTestSession(req.headers?.cookie);
  };

  function buildMockAccount(player: PlayerIdentity) {
    const badges = [...(player.badges ?? [])];
    const activeBadges = [...(player.activeBadges ?? [])];
    return {
      _id: player.playerId,
      id: player.playerId,
      displayName: player.displayName,
      profilePicture: player.profilePicture,
      badges,
      activeBadges,
      rating: { overall: { elo: 1500, gamesPlayed: 0 } },
      hasSeenTutorial: false,
      friends: [],
      save: async () => {},
    };
  }

  mod.requireAccount = async (
    req: { headers: { cookie?: string } },
    res: { status: (code: number) => { json: (body: unknown) => void } },
  ) => {
    const player = getTestSession(req.headers.cookie);
    if (!player) {
      res.status(401).json({ code: "NOT_AUTHENTICATED", message: "Not authenticated." });
      return null;
    }
    if (player.kind !== "account") {
      res.status(403).json({ code: "ACCOUNT_REQUIRED", message: "Account required." });
      return null;
    }
    return buildMockAccount(player);
  };

  mod.requireAdmin = async (
    req: { headers: { cookie?: string } },
    res: { status: (code: number) => { json: (body: unknown) => void } },
  ) => {
    const player = getTestSession(req.headers.cookie);
    if (!player) {
      res.status(401).json({ code: "NOT_AUTHENTICATED", message: "Not authenticated." });
      return null;
    }
    if (player.kind !== "account") {
      res.status(403).json({ code: "ACCOUNT_REQUIRED", message: "Account required." });
      return null;
    }
    if (!player.isAdmin) {
      res.status(403).json({ code: "ADMIN_REQUIRED", message: "Admin access is required." });
      return null;
    }
    return buildMockAccount(player);
  };
}
