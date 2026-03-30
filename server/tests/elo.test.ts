import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { computeExpectedScore, getKFactor, computeNewRatings, DEFAULT_RATING } from "../game/elo";

describe("DEFAULT_RATING", () => {
  test("is 1500", () => {
    assert.equal(DEFAULT_RATING, 1500);
  });
});

describe("computeExpectedScore", () => {
  test("equal ratings produce 0.5", () => {
    assert.equal(computeExpectedScore(1500, 1500), 0.5);
    assert.equal(computeExpectedScore(2000, 2000), 0.5);
    assert.equal(computeExpectedScore(800, 800), 0.5);
  });

  test("higher-rated player A has expected score > 0.5", () => {
    assert.ok(computeExpectedScore(1600, 1400) > 0.5);
    assert.ok(computeExpectedScore(2400, 1500) > 0.5);
  });

  test("lower-rated player A has expected score < 0.5", () => {
    assert.ok(computeExpectedScore(1400, 1600) < 0.5);
    assert.ok(computeExpectedScore(1500, 2400) < 0.5);
  });

  test("200-point difference gives ~0.76 for stronger player", () => {
    const score = computeExpectedScore(1700, 1500);
    assert.ok(Math.abs(score - 0.7597) < 0.001);
  });

  test("expected scores of A vs B and B vs A sum to 1", () => {
    const scoreAB = computeExpectedScore(1800, 1400);
    const scoreBA = computeExpectedScore(1400, 1800);
    assert.ok(Math.abs(scoreAB + scoreBA - 1) < 1e-10);
  });

  test("extreme difference: much stronger A approaches 1", () => {
    const score = computeExpectedScore(2800, 800);
    assert.ok(score > 0.99);
  });

  test("extreme difference: much weaker A approaches 0", () => {
    const score = computeExpectedScore(800, 2800);
    assert.ok(score < 0.01);
  });
});

describe("getKFactor", () => {
  test("provisional player (<30 games) returns 40", () => {
    assert.equal(getKFactor(1500, 0), 40);
    assert.equal(getKFactor(1500, 15), 40);
    assert.equal(getKFactor(1500, 29), 40);
  });

  test("provisional K-factor applies regardless of rating", () => {
    assert.equal(getKFactor(2500, 10), 40);
    assert.equal(getKFactor(2800, 0), 40);
  });

  test("boundary: exactly 30 games is not provisional", () => {
    assert.notEqual(getKFactor(1500, 30), 40);
  });

  test("regular player (>=30 games, <2400 rating) returns 20", () => {
    assert.equal(getKFactor(1500, 30), 20);
    assert.equal(getKFactor(2000, 50), 20);
    assert.equal(getKFactor(2399, 100), 20);
  });

  test("boundary: exactly 2400 rating with >=30 games returns 10", () => {
    assert.equal(getKFactor(2400, 30), 10);
  });

  test("master player (>=2400 rating, >=30 games) returns 10", () => {
    assert.equal(getKFactor(2400, 50), 10);
    assert.equal(getKFactor(2700, 100), 10);
    assert.equal(getKFactor(2800, 30), 10);
  });
});

describe("computeNewRatings", () => {
  test("A wins (scoreA=1) against equal opponent: A gains, B loses", () => {
    const result = computeNewRatings(1500, 50, 1500, 50, 1);
    assert.ok(result.newRatingA > 1500);
    assert.ok(result.newRatingB < 1500);
  });

  test("B wins (scoreA=0) against equal opponent: A loses, B gains", () => {
    const result = computeNewRatings(1500, 50, 1500, 50, 0);
    assert.ok(result.newRatingA < 1500);
    assert.ok(result.newRatingB > 1500);
  });

  test("draw (scoreA=0.5) with equal ratings: no change", () => {
    const result = computeNewRatings(1500, 50, 1500, 50, 0.5);
    assert.equal(result.newRatingA, 1500);
    assert.equal(result.newRatingB, 1500);
  });

  test("A wins against weaker B: smaller gain than vs equal opponent", () => {
    const vsEqual = computeNewRatings(1500, 50, 1500, 50, 1);
    const vsWeaker = computeNewRatings(1700, 50, 1300, 50, 1);
    const gainVsEqual = vsEqual.newRatingA - 1500;
    const gainVsWeaker = vsWeaker.newRatingA - 1700;
    assert.ok(gainVsWeaker >= 0);
    assert.ok(gainVsWeaker < gainVsEqual);
  });

  test("upset: weaker A beats stronger B yields large gain", () => {
    const result = computeNewRatings(1200, 50, 2000, 50, 1);
    const gainA = result.newRatingA - 1200;
    assert.ok(gainA > 15);
  });

  test("provisional player vs regular: provisional uses K=40", () => {
    const result = computeNewRatings(1500, 10, 1500, 50, 1);
    const gainA = result.newRatingA - 1500;
    const lossB = 1500 - result.newRatingB;
    // A (provisional, K=40) gains more than B (regular, K=20) loses
    assert.equal(gainA, 20); // 40 * (1 - 0.5) = 20
    assert.equal(lossB, 10); // 20 * (0 - 0.5) => loss of 10
  });

  test("provisional vs master: K-factor difference is large", () => {
    // Provisional (K=40) vs master (K=10)
    const result = computeNewRatings(1500, 5, 2500, 100, 1);
    const kA = 40;
    const kB = 10;
    assert.ok(kA > kB);
    // Just verify ratings moved in the right direction
    assert.ok(result.newRatingA > 1500);
    assert.ok(result.newRatingB < 2500);
  });

  test("ratings are rounded to integers", () => {
    const result = computeNewRatings(1500, 50, 1600, 50, 1);
    assert.equal(result.newRatingA, Math.round(result.newRatingA));
    assert.equal(result.newRatingB, Math.round(result.newRatingB));
  });
});

describe("symmetry and conservation", () => {
  test("A winning gives same magnitude change as B winning (equal K-factors)", () => {
    const aWins = computeNewRatings(1500, 50, 1500, 50, 1);
    const bWins = computeNewRatings(1500, 50, 1500, 50, 0);

    const gainWhenAWins = aWins.newRatingA - 1500;
    const gainWhenBWins = bWins.newRatingB - 1500;
    assert.equal(gainWhenAWins, gainWhenBWins);
  });

  test("A winning with unequal start ratings: symmetric for swapped players", () => {
    const result1 = computeNewRatings(1600, 50, 1400, 50, 1);
    const result2 = computeNewRatings(1400, 50, 1600, 50, 0);

    // When A(1600) beats B(1400), A's gain should equal
    // the gain B(1600) gets when B(1600) beats A(1400)
    const gain1 = result1.newRatingA - 1600;
    const gain2 = result2.newRatingB - 1600;
    assert.equal(gain1, gain2);
  });

  test("rating changes sum to zero when K-factors are equal", () => {
    // Both players non-provisional, <2400 => K=20
    const cases: [number, number, number][] = [
      [1500, 1500, 1],
      [1500, 1500, 0],
      [1500, 1500, 0.5],
      [1800, 1400, 1],
      [1800, 1400, 0],
      [1800, 1400, 0.5],
      [2000, 2300, 0.5],
    ];

    for (const [rA, rB, score] of cases) {
      const result = computeNewRatings(rA, 50, rB, 50, score);
      const changeA = result.newRatingA - rA;
      const changeB = result.newRatingB - rB;
      // May not be exactly zero due to rounding, but should be within 1
      assert.ok(
        Math.abs(changeA + changeB) <= 1,
        `ratings ${rA} vs ${rB}, score ${score}: changes ${changeA} + ${changeB} != 0`,
      );
    }
  });

  test("rating changes do NOT sum to zero when K-factors differ", () => {
    // Provisional (K=40) vs regular (K=20)
    const result = computeNewRatings(1500, 10, 1500, 50, 1);
    const changeA = result.newRatingA - 1500;
    const changeB = result.newRatingB - 1500;
    // With different K-factors, total rating is not conserved
    assert.notEqual(changeA + changeB, 0);
  });
});
