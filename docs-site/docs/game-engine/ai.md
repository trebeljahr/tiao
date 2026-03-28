---
sidebar_position: 2
title: AI Engine
---

# AI Engine

The Tiao AI runs entirely in the browser. There is no server-side computation — the engine executes in a [Web Worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) so the UI stays responsive while the search runs. The core implementation lives in [`tiao-engine.ts`][fn-tiao-engine.ts].

## Architecture

```
User clicks "Play with a Bot"
        │
        ▼
  ComputerGamePage
        │
        ▼
  useComputerGame hook ──── manages turns, undo, difficulty
        │
        ▼
  computer-ai.ts ─────────── spawns Web Worker, handles cancel
        │
        ▼
  tiao-engine.worker.ts ──── runs in a separate thread
        │
        ▼
  tiao-engine.ts ─────────── negamax search + evaluation
        │
        ▼
  shared/src/tiao.ts ─────── game rules (placePiece, jumpPiece, etc.)
```

Source files:

- [`tiao-engine.ts`][fn-tiao-engine.ts] — search algorithm, evaluation, move generation (765 lines)
- [`tiao-engine.worker.ts`][fn-tiao-engine.worker.ts] — Web Worker entry point
- [`computer-ai.ts`][fn-computer-ai.ts] — orchestration and cancellation
- [`useComputerGame.ts`][fn-useComputerGame.ts] — React hook for game integration

## Search Algorithm

The engine uses [negamax](https://en.wikipedia.org/wiki/Negamax) with [alpha-beta pruning](https://en.wikipedia.org/wiki/Alpha%E2%80%93beta_pruning), a standard technique in game AI. Negamax is a simplified form of minimax that exploits the zero-sum property: one player's gain is the other's loss, so `score(position, playerA) = -score(position, playerB)`.

### How the search works

The [`findBestMove`][fn-findBestMove] function uses [iterative deepening](https://en.wikipedia.org/wiki/Iterative_deepening_depth-first_search): it searches at depth 1, then depth 2, then depth 3, and so on up to the configured maximum. Each iteration builds on the previous one through the transposition table. If more than 50% of the time budget is used and a result exists, it stops early.

At each node, the engine:

1. Checks for terminal states (game over) and returns the win/loss score
2. Probes the transposition table for a cached result
3. Tries null move pruning to quickly prove strong positions
4. Generates all legal moves and orders them by priority
5. Recursively evaluates each move, pruning branches that can't improve the result

```
negamax(state, depth, alpha, beta):
  if game is over → return ±WIN_SCORE
  if depth = 0    → run quiescence search on captures

  probe transposition table for cached result
  try null move pruning (skip a turn, search with reduced depth)

  for each move (ordered by priority):
    newState = apply move
    score = -negamax(newState, depth-1, -beta, -alpha)

    if score ≥ beta → prune (this branch is too good, opponent won't allow it)
    if score > alpha → update best score

  store result in transposition table
  return best score
```

Alpha-beta pruning dramatically reduces the search space. In the best case (with perfect move ordering), it examines √N nodes instead of N, effectively doubling the search depth for the same computation time.

## Evaluation Function

The [`evaluate`][fn-evaluate] function scores a position from the current player's perspective. The score is a weighted sum of several factors:

| Factor             | Weight | Description                                                                                                                               |
| ------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Captures           | ×1000  | Difference in captured pieces — the most important factor since 10 captures wins                                                          |
| Jump opportunities | ×80/85 | Number of pieces that can initiate a jump. Opponent jumps are weighted slightly higher (×85) to encourage defensive awareness             |
| Piece count        | ×3     | Having more pieces on the board gives more tactical options                                                                               |
| Center control     | ×2     | Pieces near the center of the 19×19 board score higher (measured by [Manhattan distance](https://en.wikipedia.org/wiki/Taxicab_geometry)) |
| Connectivity       | ×1     | Orthogonally adjacent same-color pieces. Encourages grouped formations                                                                    |

Terminal positions return ±50,000 (plus depth bonus to prefer faster wins).

## Zobrist Hashing

The engine uses [Zobrist hashing](https://en.wikipedia.org/wiki/Zobrist_hashing) to efficiently identify board positions. Each square+color combination gets a random 32-bit number (generated with an [xorshift](https://en.wikipedia.org/wiki/Xorshift) PRNG at startup). The hash is the XOR of all piece hashes plus the side-to-move bit and a score component:

```typescript
hash = 0
for each piece on the board:
    hash ^= zobristPiece[y][x][colorIndex]
if black to move:
    hash ^= zobristSide
hash ^= (score.black * 73856093)
hash ^= (score.white * 19349669)
```

XOR is its own inverse, which makes updates efficient — placing or removing a piece just XORs the relevant value. The [`computeZobristHash`][fn-computeZobristHash] function computes the full hash from scratch; during search, hashes are computed once per node.

## Transposition Table

A [transposition table](https://en.wikipedia.org/wiki/Transposition_table) caches previously evaluated positions to avoid redundant work. The same board position can be reached through different move orders (transpositions), and the table lets the engine reuse earlier results.

Each entry stores:

- **hash** — Zobrist hash of the position
- **depth** — how deep this position was searched
- **score** — the evaluated score
- **flag** — `"exact"` (true value), `"lower"` (beta cutoff), or `"upper"` (failed low)
- **bestMoveKey** — the best move found, used for move ordering in future searches

The table holds up to 65,536 entries with FIFO eviction. The `ttProbe` and `ttStore` functions manage lookups and insertions.

## Move Ordering

Good [move ordering](https://www.chessprogramming.org/Move_Ordering) is critical for alpha-beta efficiency. The earlier a good move is tried, the more branches can be pruned. The `orderMoves` function sorts moves by this priority:

1. **Transposition table best move** — the move that was best in a previous search of this position
2. **Captures before placements** — jumps are more likely to be decisive
3. **Longer chains first** — a 3-hop jump captures more than a 1-hop jump
4. **Killer moves** — moves that caused a beta cutoff at the same depth in a sibling node (two slots per depth)
5. **History heuristic** — moves that have historically caused cutoffs get a cumulative bonus (depth²)
6. **Center proximity** — placements closer to the center are tried first

## Quiescence Search

[Quiescence search](https://en.wikipedia.org/wiki/Quiescence_search) addresses the [horizon effect](https://en.wikipedia.org/wiki/Horizon_effect): when the search reaches its depth limit, the position might be in the middle of a capture sequence. Evaluating it statically would give a misleading score.

When the main search reaches depth 0, instead of returning the static evaluation, the `quiescence` function continues searching — but only considers capture moves (jumps). This continues for up to 4 additional plies. At each node, the "stand pat" score (static evaluation) is used as a lower bound: the current player can always choose not to capture.

## Null Move Pruning

[Null-move pruning](https://en.wikipedia.org/wiki/Null-move_heuristic) is an optimization based on the assumption that doing nothing (passing your turn) is usually worse than making any move. If giving the opponent a free move still results in a score ≥ beta, the position is so strong that we can prune without searching further.

The engine applies null move pruning at depths ≥ 3, searching the null position with a depth reduction of 3. It is disabled during capture sequences (pending jumps) and when the previous node already used a null move.

## Difficulty Levels

The engine offers three difficulty presets that control search depth and time budget:

| Level | Label        | Max Depth | Time Budget |
| ----- | ------------ | --------- | ----------- |
| 1     | Easy         | 5         | 3 seconds   |
| 2     | Intermediate | 6         | 5 seconds   |
| 3     | Hard         | 6         | 6 seconds   |

All levels use null move pruning, quiescence search, and full move ordering. The difference is primarily in search depth and how long the engine is allowed to think.

## Move Generation

The [`generateMoves`][fn-generateMoves] function produces all legal moves for the current player:

1. **Jump moves** — for each piece that can jump, recursively explore all multi-hop chains using `collectJumpChains`. Each chain (including partial chains) is a separate candidate move.
2. **Placement moves** — scan all empty intersections, check legality via the shared engine's `canPlacePiece`, and sort by adjacency to existing stones + center proximity.

To keep the search tractable on open boards (where hundreds of placements may be legal), only the top 50 moves are considered at each node.

## Web Worker Integration

The search runs in a [Web Worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) ([`tiao-engine.worker.ts`][fn-tiao-engine.worker.ts]) so the main thread stays responsive during computation. The orchestration layer ([`computer-ai.ts`][fn-computer-ai.ts]) manages the worker lifecycle:

- **Cancellation**: an `abort` flag is checked every 256 nodes. The [`useComputerGame`][fn-useComputerGame.ts] hook cancels in-flight searches on undo or navigation.
- **Progress reporting**: the worker reports progress every 100ms so the UI can show a thinking indicator.
- **Move delay**: a 440ms artificial delay before applying the AI's move gives the UI a natural "thinking" feel.
- **Multi-hop animation**: when the AI plays a jump chain, each hop is animated with a 350ms delay between steps.
