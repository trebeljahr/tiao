import catalogue from "./generatedPuzzles.json";
import type { GeneratedPuzzleRecord } from "./puzzleGeneration";
import { describePuzzleMove, puzzleCoordinate } from "./puzzleRules";
import type { Puzzle } from "./puzzles";

export const PUZZLE_POOL: Puzzle[] = (catalogue as GeneratedPuzzleRecord[]).map((record, index) => {
  const opening = record.line[0];
  const start = opening.type === "place" ? opening.position : opening.from;
  return {
    ...record,
    id: `puzzle-${String(index + 1).padStart(3, "0")}`,
    title: `Puzzle ${String(index + 1).padStart(3, "0")}`,
    difficulty: "Puzzle",
    hints: [
      record.turns === 1
        ? `You need ${10 - record.score[record.player]} captures this turn.`
        : "Consider placements as well as captures. Your first turn must work against every reply.",
      opening.type === "place"
        ? `Consider placing near ${puzzleCoordinate(start)}.`
        : `Look for a route starting at ${puzzleCoordinate(start)}.`,
      describePuzzleMove(opening),
    ],
    explanation:
      record.turns === 1
        ? "This route reaches the capture target in one turn."
        : "This first turn leaves a winning capture against every legal reply. One continuation is shown below.",
  };
});
