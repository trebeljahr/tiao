// @ts-check
/**
 * Unit tests for desktop/src/steam.cjs.
 *
 * Uses node's built-in test runner (node --test) to match the style of
 * csp.test.cjs and keep vitest/jest out of the desktop package.
 *
 * The tests deliberately avoid loading `steamworks.js`: they exercise
 * only the gating + degraded paths that the rest of the desktop app
 * relies on for graceful behavior when:
 *   - STEAM_BUILD is unset (the standalone / itch.io binary), OR
 *   - Steam init fails (Steam client not running, wrong appid, etc.).
 *
 * The "active" paths can't be unit-tested without a live Steam
 * client; they're verified manually against the Spacewar appid (480)
 * during release prep.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  STEAM_ENABLED,
  initSteam,
  isSteamActive,
  getSteamUser,
  unlockAchievement,
  indicateAchievementProgress,
  getAchievementStates,
  openOverlay,
  openOverlayUrl,
  OVERLAY_DIALOG_CODES,
} = require("./steam.cjs");

describe("steam module gating", () => {
  test("STEAM_ENABLED reflects the STEAM_BUILD env flag", () => {
    assert.equal(STEAM_ENABLED, process.env.STEAM_BUILD === "true");
  });

  test("initSteam returns false and isSteamActive stays false when gate off", () => {
    if (STEAM_ENABLED) return; // skip in steam-build CI lane
    assert.equal(initSteam(), false);
    assert.equal(isSteamActive(), false);
  });
});

describe("inactive-client safety", () => {
  test("getSteamUser returns null", () => {
    assert.equal(getSteamUser(), null);
  });

  test("unlockAchievement is a no-op (no throw)", () => {
    assert.doesNotThrow(() => unlockAchievement("ACH_TEST"));
  });

  test("indicateAchievementProgress is a no-op (no throw)", () => {
    assert.doesNotThrow(() => indicateAchievementProgress("ACH_TEST", 1, 10));
  });

  test("getAchievementStates returns {} for any input shape", () => {
    assert.deepEqual(getAchievementStates(["a", "b"]), {});
    // @ts-expect-error — intentionally passing a non-array
    assert.deepEqual(getAchievementStates(null), {});
    // @ts-expect-error — intentionally passing a non-array
    assert.deepEqual(getAchievementStates("oops"), {});
  });

  test("openOverlay returns false for both valid and invalid names when client is null", () => {
    assert.equal(openOverlay("Achievements"), false);
    assert.equal(openOverlay("BogusPanel"), false);
    // @ts-expect-error — wrong arg type
    assert.equal(openOverlay(42), false);
  });

  test("openOverlayUrl returns false for non-http URLs even before client check", () => {
    assert.equal(openOverlayUrl("ftp://example.com"), false);
    assert.equal(openOverlayUrl("javascript:alert(1)"), false);
    assert.equal(openOverlayUrl(""), false);
    // @ts-expect-error — wrong arg type
    assert.equal(openOverlayUrl(null), false);
  });
});

describe("overlay dialog code map", () => {
  test("all 7 Steam overlay panels are covered", () => {
    // Mirrors the public Steamworks dialog set the renderer is allowed
    // to ask for. Adding a new panel here means updating preload.cjs's
    // openOverlay typedef too.
    const expected = [
      "Friends",
      "Community",
      "Players",
      "Settings",
      "OfficialGameGroup",
      "Stats",
      "Achievements",
    ];
    for (const name of expected) {
      assert.equal(typeof OVERLAY_DIALOG_CODES[name], "number");
    }
  });

  test("codes are unique", () => {
    const codes = Object.values(OVERLAY_DIALOG_CODES);
    assert.equal(new Set(codes).size, codes.length);
  });
});
