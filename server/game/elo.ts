/**
 * Standard Chess Elo rating calculation.
 */

const DEFAULT_RATING = 1500;

export function computeExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function getKFactor(rating: number, gamesPlayed: number): number {
  if (gamesPlayed < 30) return 40; // Provisional
  if (rating < 2400) return 20;
  return 10;
}

export type EloResult = {
  newRatingA: number;
  newRatingB: number;
};

/**
 * Compute new ratings for two players after a game.
 * @param scoreA - 1.0 for A wins, 0.0 for B wins, 0.5 for draw
 */
export function computeNewRatings(
  ratingA: number,
  gamesPlayedA: number,
  ratingB: number,
  gamesPlayedB: number,
  scoreA: number,
): EloResult {
  const expectedA = computeExpectedScore(ratingA, ratingB);
  const expectedB = 1 - expectedA;

  const kA = getKFactor(ratingA, gamesPlayedA);
  const kB = getKFactor(ratingB, gamesPlayedB);

  return {
    newRatingA: Math.round(ratingA + kA * (scoreA - expectedA)),
    newRatingB: Math.round(ratingB + kB * (1 - scoreA - expectedB)),
  };
}

export { DEFAULT_RATING };
