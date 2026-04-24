process.env.TOKEN_SECRET = "test-secret";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/tiao-test";
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_IDS,
  getAchievementById,
} from "../../shared/src/achievements";

// ---------------------------------------------------------------------------
// Achievement definitions tests (pure data, no DB)
// ---------------------------------------------------------------------------

describe("Achievement definitions", () => {
  test("all achievements have unique IDs", () => {
    const ids = new Set<string>();
    for (const a of ACHIEVEMENTS) {
      assert.ok(!ids.has(a.id), `Duplicate achievement ID: ${a.id}`);
      ids.add(a.id);
    }
  });

  test("all achievements have required fields", () => {
    for (const a of ACHIEVEMENTS) {
      assert.ok(a.id, `Missing id`);
      assert.ok(a.name, `Missing name for ${a.id}`);
      assert.ok(a.description, `Missing description for ${a.id}`);
      assert.ok(a.category, `Missing category for ${a.id}`);
      assert.ok(a.tier, `Missing tier for ${a.id}`);
      assert.equal(typeof a.secret, "boolean", `secret should be boolean for ${a.id}`);
      assert.equal(typeof a.order, "number", `order should be number for ${a.id}`);
    }
  });

  test("tiers are valid values", () => {
    const validTiers = new Set(["bronze", "silver", "gold", "platinum"]);
    for (const a of ACHIEVEMENTS) {
      assert.ok(validTiers.has(a.tier), `Invalid tier "${a.tier}" for ${a.id}`);
    }
  });

  test("categories are valid values", () => {
    const validCategories = new Set(ACHIEVEMENT_CATEGORIES.map((c) => c.key));
    for (const a of ACHIEVEMENTS) {
      assert.ok(validCategories.has(a.category), `Invalid category "${a.category}" for ${a.id}`);
    }
  });

  test("getAchievementById returns correct achievement", () => {
    const firstMove = getAchievementById("first-move");
    assert.ok(firstMove);
    assert.equal(firstMove.name, "First Move");
    assert.equal(firstMove.tier, "bronze");
    assert.equal(firstMove.category, "games");
  });

  test("getAchievementById returns undefined for unknown ID", () => {
    const result = getAchievementById("nonexistent-achievement");
    assert.equal(result, undefined);
  });

  test("ACHIEVEMENT_IDS matches ACHIEVEMENTS array", () => {
    assert.equal(ACHIEVEMENT_IDS.length, ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      assert.ok(ACHIEVEMENT_IDS.includes(a.id), `Missing ID in ACHIEVEMENT_IDS: ${a.id}`);
    }
  });

  test("progressive achievements have thresholds", () => {
    // "first-move" is intentionally excluded — it's binary (fires on the
    // player's first move in a multiplayer game), not progression-based.
    const progressiveIds = [
      "getting-started",
      "regular",
      "centurion",
      "veteran",
      "first-fall",
      "tough-luck",
      "punching-bag",
      "first-friend",
      "social-butterfly",
    ];
    for (const id of progressiveIds) {
      const def = getAchievementById(id);
      assert.ok(def, `Achievement ${id} should exist`);
      assert.ok(
        typeof def!.threshold === "number" && def!.threshold > 0,
        `${id} should have a positive threshold`,
      );
    }
  });

  test("first-move has no threshold (fires on first move, not game count)", () => {
    const def = getAchievementById("first-move");
    assert.ok(def);
    assert.equal(def.threshold, undefined);
  });

  test("secret achievements are all in the secret category", () => {
    for (const a of ACHIEVEMENTS) {
      if (a.secret) {
        assert.equal(
          a.category,
          "secret",
          `Secret achievement ${a.id} should be in "secret" category`,
        );
      }
    }
  });

  test("expected achievements exist", () => {
    const requiredIds = [
      "first-move",
      "getting-started",
      "regular",
      "centurion",
      "veteran",
      "first-fall",
      "tough-luck",
      "punching-bag",
      "speed-demon",
      "buzzer-beater",
      "one-second-glory",
      "ai-easy",
      "ai-medium",
      "ai-hard",
      "first-friend",
      "social-butterfly",
      "top-one-percent",
      "tournament-champion",
      "tutorial-complete",
      "spectator",
      "rage-quit",
      "night-owl",
      "speedrun",
      "comeback-kid",
      "flawless-victory",
      "david-vs-goliath",
      "checkered-past",
      "first-blood",
      "chain-reaction",
      "one-jump-wonder",
    ];
    for (const id of requiredIds) {
      assert.ok(getAchievementById(id), `Expected achievement "${id}" to exist`);
    }
  });

  test("game-count thresholds are in ascending order", () => {
    // "first-move" is intentionally excluded — it no longer has a threshold.
    const gameAchievements = ["getting-started", "regular", "centurion", "veteran"];
    let prevThreshold = 0;
    for (const id of gameAchievements) {
      const def = getAchievementById(id)!;
      assert.ok(
        def.threshold! > prevThreshold,
        `${id} threshold (${def.threshold}) should be > ${prevThreshold}`,
      );
      prevThreshold = def.threshold!;
    }
  });

  test("loss thresholds are in ascending order", () => {
    const lossAchievements = ["first-fall", "tough-luck", "punching-bag"];
    let prevThreshold = 0;
    for (const id of lossAchievements) {
      const def = getAchievementById(id)!;
      assert.ok(
        def.threshold! > prevThreshold,
        `${id} threshold (${def.threshold}) should be > ${prevThreshold}`,
      );
      prevThreshold = def.threshold!;
    }
  });
});
