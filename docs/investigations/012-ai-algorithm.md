# Investigation: AI Algorithm

**Status:** Decided
**Date:** 2025

## Context

The game includes a single-player mode against a computer opponent. The AI needs to play reasonably well while running entirely in the browser (no server-side computation).

## Options Considered

### Monte Carlo Tree Search (MCTS)

- State of the art for Go-like games (used by AlphaGo)
- Requires many playouts to be effective — computationally expensive
- Overkill for a smaller board game with simpler rules than Go
- Difficult to tune for consistent play within browser time constraints

### Minimax / Negamax with Alpha-Beta Pruning (chosen)

- Classic game tree search, well-understood
- Alpha-beta pruning cuts search space dramatically
- Quiescence search extends captures up to 4 additional plies to avoid horizon effect
- Predictable performance characteristics — can control depth to match difficulty levels
- Runs in a Web Worker to keep UI responsive

### Neural Network / ML-based

- Would require training data and a model
- Heavy client-side inference (unless server-hosted)
- Massive over-engineering for current scope

### Random / Heuristic-only

- Trivial to implement but unsatisfying to play against
- No strategic depth

## Outcome

Negamax with alpha-beta pruning and quiescence search, running client-side in a Web Worker. The algorithm is implemented in the shared game engine, using the same pure functions as multiplayer validation. This means the AI plays by exactly the same rules as human players, with no special access to game internals.

The tradeoff is that depth is limited by browser CPU — on mobile devices, deeper searches can cause noticeable delays. Difficulty levels are controlled by search depth.
