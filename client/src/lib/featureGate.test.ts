import { describe, it, expect } from "vitest";
import type { AuthResponse } from "@shared";
import { hasPreviewAccess, isAdmin, resolvePlayerBadges } from "./featureGate";

function makeAuth(overrides: Partial<AuthResponse["player"]> = {}): AuthResponse {
  return {
    player: {
      playerId: "test-id",
      displayName: "testuser",
      kind: "account",
      badges: [],
      activeBadges: [],
      ...overrides,
    },
  };
}

describe("hasPreviewAccess", () => {
  it("returns false for null auth", () => {
    expect(hasPreviewAccess(null)).toBe(false);
  });

  it("returns false for guest player", () => {
    const auth = makeAuth({ kind: "guest" });
    expect(hasPreviewAccess(auth)).toBe(false);
  });

  it("returns false for account with no badges", () => {
    const auth = makeAuth({ badges: [] });
    expect(hasPreviewAccess(auth)).toBe(false);
  });

  it("returns true for account with badges", () => {
    const auth = makeAuth({ badges: ["creator"] });
    expect(hasPreviewAccess(auth)).toBe(true);
  });
});

describe("isAdmin", () => {
  it("returns false for null auth", () => {
    expect(isAdmin(null)).toBe(false);
  });

  it("returns false for guest player", () => {
    const auth = makeAuth({ kind: "guest" });
    expect(isAdmin(auth)).toBe(false);
  });

  it("returns false for account without isAdmin flag", () => {
    const auth = makeAuth();
    expect(isAdmin(auth)).toBe(false);
  });

  it("returns true for account with isAdmin flag", () => {
    const auth = makeAuth({ isAdmin: true });
    expect(isAdmin(auth)).toBe(true);
  });
});

describe("resolvePlayerBadges", () => {
  it("returns empty array for null player", () => {
    expect(resolvePlayerBadges(null)).toEqual([]);
  });

  it("returns empty array for undefined player", () => {
    expect(resolvePlayerBadges(undefined)).toEqual([]);
  });

  it("returns empty array when activeBadges is empty (user chose hidden)", () => {
    expect(resolvePlayerBadges({ activeBadges: [] })).toEqual([]);
  });

  it("returns valid active badges from server data", () => {
    expect(resolvePlayerBadges({ activeBadges: ["creator", "supporter"] })).toEqual([
      "creator",
      "supporter",
    ]);
  });

  it("filters out unknown badge IDs", () => {
    expect(resolvePlayerBadges({ activeBadges: ["creator", "nonexistent-badge"] })).toEqual([
      "creator",
    ]);
  });

  it("returns empty array when no activeBadges property exists", () => {
    expect(resolvePlayerBadges({})).toEqual([]);
  });
});
