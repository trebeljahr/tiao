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
 * client; they're verified manually through a Steam beta branch of
 * appid 5035580 during release prep.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  STEAM_ENABLED,
  STEAM_APPID,
  maybeRestartForSteam,
  prepareSteamOverlay,
  initSteam,
  isSteamActive,
  getSteamUser,
  unlockAchievement,
  indicateAchievementProgress,
  getAchievementStates,
  setStats,
  openOverlay,
  openOverlayUrl,
  OVERLAY_DIALOG_CODES,
} = require("./steam.cjs");

const pkg =
  /** @type {typeof import("../package.json") & { steamBuild?: boolean | string; steamAppId?: number | string }} */ (
    require("../package.json")
  );

describe("steam module gating", () => {
  test("STEAM_ENABLED honors the env flag OR baked package metadata", () => {
    // Two independent sources flip the gate on: STEAM_BUILD in the
    // environment (dev/CI) and `steamBuild` baked into package.json by
    // `package:steam` (the packaged artifact).  The packaged path is
    // the load-bearing one — env vars do not survive packaging, and
    // Steam launches the binary with its own environment.
    const fromEnv = process.env.STEAM_BUILD === "true";
    const fromMeta = pkg.steamBuild === true || pkg.steamBuild === "true";
    assert.equal(STEAM_ENABLED, fromEnv || fromMeta);
  });

  test("STEAM_APPID falls back to Tiao's own appid", () => {
    const explicit =
      Number.parseInt(process.env.TIAO_STEAM_APPID ?? "", 10) ||
      Number.parseInt(String(pkg.steamAppId ?? ""), 10);
    assert.equal(STEAM_APPID, explicit || 5035580);
  });

  test("steam_appid.txt keeps dev pointed at Tiao, not Spacewar", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const text = fs.readFileSync(path.join(__dirname, "..", "steam_appid.txt"), "utf8").trim();
    assert.equal(text, "5035580");
  });

  test("initSteam returns false and isSteamActive stays false when gate off", () => {
    if (STEAM_ENABLED) return; // skip in steam-build CI lane
    assert.equal(initSteam(), false);
    assert.equal(isSteamActive(), false);
  });
});

describe("pre-ready phases", () => {
  // Both of these run before app.whenReady() in main.cjs. They must be
  // safe to call unconditionally — a standalone build calls them too.
  test("maybeRestartForSteam is false when the gate is off", () => {
    if (STEAM_ENABLED) return;
    assert.equal(maybeRestartForSteam(true), false);
  });

  test("maybeRestartForSteam is false in unpackaged (dev) runs", () => {
    // Dev legitimately runs outside Steam; the DRM check must never
    // hijack the dev loop even in a STEAM_BUILD=true shell.
    assert.equal(maybeRestartForSteam(false), false);
  });

  test("prepareSteamOverlay is a no-op that reports failure when gate off", () => {
    if (STEAM_ENABLED) return;
    assert.equal(prepareSteamOverlay(), false);
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

  test("setStats reports failure without writing when the client is null", () => {
    // Stats drive achievement progress bars. With no Steam client there is
    // nothing to write to, and the caller needs to know the push didn't
    // land rather than assuming Steam has the value.
    assert.deepEqual(setStats({ STAT_GAMES_PLAYED: 5 }), {
      ok: false,
      written: 0,
      stored: false,
    });
  });

  test("setStats tolerates junk input without throwing", () => {
    for (const bad of [null, undefined, "nope", 42, []]) {
      // @ts-expect-error — intentionally passing non-record values
      assert.doesNotThrow(() => setStats(bad));
    }
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
