// Offline, deterministic mining. Run: pnpm --dir server exec tsx --tsconfig ../client/tsconfig.json ../scripts/generate-puzzles.ts
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  canonicalPuzzleBoard,
  type GeneratedPuzzleRecord,
  recordPuzzle,
  simulatedGame,
} from "../client/src/lib/puzzles/puzzleGeneration";
import {
  PuzzleSearchLimit,
  type PuzzleTurn,
  puzzleTurns,
  winningPuzzleTurns,
} from "../client/src/lib/puzzles/puzzleRules";
import { getWinner } from "../shared/src/tiao";

const quotas = { short: 50, long: 50, placement: 50, preparation: 50 };
const buckets: Record<keyof typeof quotas, GeneratedPuzzleRecord[]> = {
  short: [],
  long: [],
  placement: [],
  preparation: [],
};
const seen = new Set<string>();
const started = performance.now();
let examined = 0;
for (let seed = 1; seed <= 10000; seed++) {
  let ply = 0;
  for (const position of simulatedGame(seed)) {
    const source = { seed, ply: ply++ };
    if (position.score[position.currentTurn] < 6) continue;
    const pieces = position.positions.flat().filter(Boolean).length;
    if (pieces < 8 || pieces > 30) continue;
    const state = { ...position, history: [] };
    const key = canonicalPuzzleBoard(state);
    if (seen.has(key)) continue;
    examined++;
    const immediate = [...puzzleTurns(state)].filter(
      (turn) => getWinner(turn.state) === state.currentTurn,
    );
    let answer = immediate.length === 1 ? immediate[0] : undefined;
    let turns: 1 | 2 = 1;
    let bucket: keyof typeof quotas;
    if (answer?.move.type === "jump" && answer.move.path.length >= 2) {
      bucket = answer.move.path.length === 2 ? "short" : "long";
    } else if (
      !immediate.length &&
      (buckets.placement.length < quotas.placement ||
        buckets.preparation.length < quotas.preparation)
    ) {
      let wins: PuzzleTurn[];
      try {
        wins = winningPuzzleTurns(state, 3, { remaining: 20000 });
      } catch (error) {
        if (error instanceof PuzzleSearchLimit) continue;
        throw error;
      }
      if (wins.length !== 1) continue;
      answer = wins[0];
      turns = 2;
      bucket = answer.move.type === "place" ? "placement" : "preparation";
    } else continue;
    if (!answer || buckets[bucket].length >= quotas[bucket]) continue;
    buckets[bucket].push(recordPuzzle(state, answer, turns, source));
    seen.add(key);
    break; // At most one puzzle per source game.
  }
  if (seed % 20 === 0)
    console.log(
      JSON.stringify({
        seed,
        examined,
        counts: Object.fromEntries(
          Object.entries(buckets).map(([key, value]) => [key, value.length]),
        ),
        seconds: Math.round((performance.now() - started) / 1000),
      }),
    );
  if (
    Object.entries(quotas).every(
      ([key, count]) => buckets[key as keyof typeof quotas].length >= count,
    )
  )
    break;
}
if (
  !Object.entries(quotas).every(
    ([key, count]) => buckets[key as keyof typeof quotas].length >= count,
  )
)
  throw new Error("Could not fill puzzle pool");
// Interleave the four families; titles and navigation reveal no tactic.
const puzzles = Array.from({ length: 50 }, (_, index) => [
  buckets.short[index],
  buckets.placement[index],
  buckets.long[index],
  buckets.preparation[index],
]).flat();
const output = fileURLToPath(
  new URL("../client/src/lib/puzzles/generatedPuzzles.json", import.meta.url),
);
writeFileSync(output, JSON.stringify(puzzles) + "\n");
execFileSync(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/@biomejs/biome/bin/biome", import.meta.url)),
    "format",
    "--write",
    output,
  ],
  { stdio: "pipe" },
);
console.log(
  `Wrote ${puzzles.length} verified puzzles in ${Math.round((performance.now() - started) / 1000)} seconds.`,
);
