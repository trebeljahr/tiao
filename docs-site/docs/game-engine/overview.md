---
sidebar_position: 1
title: Game Engine Reference
---

# Game Engine Reference

The Tiao game engine lives in `shared/src/tiao.ts`. It is a collection of pure functions with zero side effects -- both the server and client use it to validate and apply moves.

## Core Types

### GameState

The central state object that represents a game in progress:

```typescript
type GameState = {
  positions: TileState[][]     // 19x19 grid (null, "white", or "black")
  currentTurn: PlayerColor     // "white" | "black"
  pendingJump: JumpStep[]      // active multi-jump chain
  pendingCaptures: Position[]  // pieces marked for removal on confirm
  score: ScoreState            // { white: number, black: number }
  history: TurnRecord[]        // all completed turns
}
```

### Position

```typescript
type Position = { x: number; y: number }
```

### RuleResult

Every game function returns a `RuleResult<T>` -- either success with a value, or failure with a code and reason:

```typescript
type RuleResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: RuleFailureCode; reason: string }
```

## Functions

### State Management

| Function | Signature | Description |
|----------|-----------|-------------|
| [`createInitialGameState()`][fn-createInitialGameState] | `() => GameState` | Empty 19x19 board, white to move, score 0-0 |
| [`cloneGameState(state)`][fn-cloneGameState] | `(GameState) => GameState` | Deep clone a game state |
| [`isGameOver(state)`][fn-isGameOver] | `(GameState) => boolean` | True if either player has 10+ captures |
| [`getWinner(state)`][fn-getWinner] | `(GameState) => PlayerColor \| null` | The winning color, or null |

### Move Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| [`placePiece(state, position)`][fn-placePiece] | `(GameState, Position) => RuleResult<GameState>` | Place a piece (validates cluster + border rules) |
| [`jumpPiece(state, from, to)`][fn-jumpPiece] | `(GameState, Position, Position) => RuleResult<GameState>` | Jump over an enemy piece |
| [`confirmPendingJump(state)`][fn-confirmPendingJump] | `(GameState) => RuleResult<GameState>` | Confirm jump chain, remove captures, switch turn |
| [`undoPendingJumpStep(state)`][fn-undoPendingJumpStep] | `(GameState) => RuleResult<GameState>` | Undo the last hop in a pending chain |
| [`undoLastTurn(state)`][fn-undoLastTurn] | `(GameState) => RuleResult<GameState>` | Undo the most recent completed turn |

### Query Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| [`canPlacePiece(state, position)`][fn-canPlacePiece] | `(GameState, Position) => RuleResult<true>` | Check if placement is legal (without applying) |
| [`getJumpTargets(state, from, color?)`][fn-getJumpTargets] | `(GameState, Position, PlayerColor?) => Position[]` | All legal jump destinations from a position |
| [`getSelectableJumpOrigins(state, color?)`][fn-getSelectableJumpOrigins] | `(GameState, PlayerColor?) => Position[]` | All pieces that can initiate a jump |
| [`getTile(state, position)`][fn-getTile] | `(GameState, Position) => TileState` | What's at a board position |
| [`isInBounds(position)`][fn-isInBounds] | `(Position) => boolean` | Is position within 19x19 |
| [`isBorderPosition(position)`][fn-isBorderPosition] | `(Position) => boolean` | Is position on an edge |
| [`findConnectedCluster(state, start)`][fn-findConnectedCluster] | `(GameState, Position) => Position[]` | All orthogonally connected same-color pieces |

### Utility Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| [`otherColor(color)`][fn-otherColor] | `(PlayerColor) => PlayerColor` | white to black, black to white |
| [`arePositionsEqual(a, b)`][fn-arePositionsEqual] | `(Position?, Position?) => boolean` | Compare two positions |
| [`getPendingJumpDestination(state)`][fn-getPendingJumpDestination] | `(GameState) => Position \| null` | Where the jumping piece currently is |
| [`isPositionMarkedForCapture(state, pos)`][fn-isPositionMarkedForCapture] | `(GameState, Position) => boolean` | Is this piece pending removal |

## Constants

```typescript
const BOARD_SIZE = 19;
const SCORE_TO_WIN = 10;
```

## Failure Codes

| Code | When |
|------|------|
| `GAME_OVER` | Game has ended, no moves allowed |
| `OUT_OF_BOUNDS` | Position outside 0-18 range |
| `OCCUPIED` | Intersection already has a piece |
| `PENDING_JUMP` | Must finish current jump before placing |
| `INVALID_CLUSTER` | Would create cluster > 10 |
| `INVALID_BORDER` | Edge placement not jumpable by enemy |
| `NO_PIECE` | No piece at jump origin |
| `NOT_YOUR_PIECE` | Piece belongs to opponent |
| `INVALID_JUMP` | Jump is not legal |
| `NO_PENDING_JUMP` | No jump chain to confirm/undo |
