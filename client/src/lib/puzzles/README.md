# Learning studies and the puzzle pool

Both routes are development-only. `page.dev.tsx` discovery and runtime guards exclude them from production web/native builds.

- `/learn`: six composed, explained studies in `puzzles.ts`.
- `/puzzles`: 200 numbered positions from deterministic simulated games, in `generatedPuzzles.json`. Source seeds and zero-based plies reproduce each position from an empty board. These are randomized legal games, not human games or competitive AI matches.

## Regenerate

From the repository root:

```sh
pnpm --dir server exec tsx --tsconfig ../client/tsconfig.json ../scripts/generate-puzzles.ts
```

The miner selects 50 two-capture finishes, 50 longer finishes, 50 placement setups, and 50 capture preparations. It takes at most one position per game, with 8–30 stones. Deduplication normalizes rotations, reflections, and the side to move and ignores scores, so rescoring a board does not create a new puzzle.

Every retained opening is the only complete first turn that forces a win within one or two player turns. Every legal opponent reply is included, as are early jump confirmation and optional placements. Mining abandons proofs exceeding its node budget; it never accepts an unfinished proof. Independent tests repeat catalogue proofs without that budget and replay every source history. This says nothing about unrestricted outcomes after other openings or human difficulty.

The six composed lessons remain separate from the generated collection. Their tactical titles are useful signposts for learning; generated puzzle titles reveal no tactic. This pool is not manually curated or difficulty-rated.

The current shared placement implementation and written cluster-size rule differ when groups merge. Catalogue validation checks all source positions and solution lines against the written limit as well; these puzzles do not require oversized groups. No core rules were changed.

## Progress

Current puzzle, visited IDs and solved IDs are saved only in this browser under `tiao-puzzle-progress-v1`. No account, network request or analytics is involved. Skipping and shuffling exhaust the active selection before repeating. Clearing site data clears progress. Hints and revealed solutions do not disqualify completion.

## Focused validation

```sh
pnpm --dir client exec vitest run src/lib/puzzles/puzzles.test.ts src/lib/puzzles/usePuzzleGame.test.tsx src/lib/puzzles/puzzleAccess.test.tsx src/lib/puzzles/puzzlePool.test.ts src/lib/puzzles/puzzleProgress.test.ts src/views/PuzzlesPage.test.tsx --maxWorkers=1
```
