# Tiao Game Rules

Tiao (跳, "jump") is a two-player strategy board game played on a 19x19 grid. Players compete to capture enemy pieces by jumping over them, similar to checkers but on a Go-sized board with unique placement constraints.

## Setup

- The board starts empty.
- Two players: **White** and **Black**.
- White always moves first.

## The Board

A 19x19 grid of intersections. Small dots mark the nine star points for orientation:

```
  0 1 2 3 4 5 6 7 8 9 ...
0 . . . . . . . . . . ...
1 . . . . . . . . . . ...
2 . . . . . . . . . . ...
3 . . . * . . . * . . ...
4 . . . . . . . . . . ...
5 . . . . . . . . . . ...
...
```

## Player Actions

On your turn you do **exactly one** of the following:

### 1. Place a Piece

Put one of your pieces on any empty intersection, subject to the [placement rules](#placement-rules) below. Your turn ends immediately.

### 2. Jump (Capture)

Jump one of your existing pieces over an adjacent enemy piece to capture it. Jumps can be:

- **Orthogonal** (up, down, left, right) -- 2 squares in one direction
- **Diagonal** -- 2 squares diagonally

The piece you jump over is marked for capture, and your piece lands on the empty intersection beyond it.

```
Before:          After jump:
. . . . .        . . . . .
. W . . .        . . . . .
. . B . .   -->  . . x . .    (x = captured, pending removal)
. . . . .        . . . W .
. . . . .        . . . . .
```

#### Chain Jumps

After completing a jump, if your piece can make another legal jump from its new position, you may continue jumping with the same piece. You can chain as many jumps as are available.

#### Confirming a Jump

After one or more jumps, you must **confirm** to end your turn. All captured pieces are removed from the board and added to your score. Until you confirm:

- You cannot place a new piece.
- You can only continue jumping with the same piece.
- You can **undo** individual jump steps to try a different path.

## Placement Rules

Placing a piece is subject to two constraints:

### Cluster Rule

A group of connected same-color pieces (orthogonally adjacent) cannot exceed **10 stones**. If placing your piece would create or expand a connected cluster beyond 10, the placement is illegal.

```
Example: 10 white stones in a row is OK.
         Placing an 11th adjacent stone is BLOCKED.

W W W W W W W W W W .    <-- 10 stones: legal
W W W W W W W W W W X    <-- 11th stone here: ILLEGAL
```

### Border Rule

You cannot place a piece on the edge of the board (row 0, row 18, column 0, or column 18) **unless** an enemy piece could reach that position through a jump sequence. This prevents safe "parking" of pieces on the borders where they cannot be captured.

```
Edge of board:

. . .
. W .      White at (1,1), black at (1,0) -- border placement at (1,0) is
B . .      ALLOWED because black is there and could be jumped into

. . .
. W .      No enemy nearby -- border placement at (0,0) is
. . .      BLOCKED
```

## Winning

The first player to capture **10 enemy pieces** wins the game. Once a player's score reaches 10, the game is over and no further moves are allowed.

## Summary

| Rule          | Description                                                              |
| ------------- | ------------------------------------------------------------------------ |
| Board         | 19x19 empty grid                                                         |
| First move    | White                                                                    |
| Place         | Put a piece on an empty intersection (subject to cluster + border rules) |
| Jump          | Leap 2 squares over an enemy piece (orthogonal or diagonal) to capture   |
| Chain jumps   | Continue jumping with the same piece if possible                         |
| Confirm       | End your jump sequence, remove captured pieces, score points             |
| Cluster limit | Max 10 connected same-color pieces                                       |
| Border limit  | Edge placements must be reachable by an enemy jump                       |
| Win condition | First to capture 10 enemy pieces                                         |

## Move Notation

Tiao uses a coordinate-based notation system for recording moves:

### Position Format

Each intersection is identified by a letter (column) and number (row):

- **Columns**: `a` through `t` (left to right, skipping `i` to avoid confusion with `1`)
- **Rows**: `1` through `19` (bottom to top)

Examples: `a1` (bottom-left corner), `t19` (top-right corner), `j10` (center)

### Move Format

Each move is recorded as: `<number>. <color> <notation>`

- **Placement**: `1. W j10` — White places a piece at j10
- **Jump**: `2. B d4×f6` — Black jumps from d4, capturing to land at f6
- **Chain jump**: `3. W d4×f6×h8` — White chain-jumps through two captures

The move history is stored in the database for all multiplayer games and can be replayed step-by-step in the game review interface.

## Error Codes

When a move is illegal, the game engine returns one of these codes:

| Code              | Meaning                                         |
| ----------------- | ----------------------------------------------- |
| `GAME_OVER`       | The game has already ended                      |
| `OUT_OF_BOUNDS`   | Position is outside the 19x19 board             |
| `OCCUPIED`        | That intersection already has a piece           |
| `PENDING_JUMP`    | You must finish the current jump sequence first |
| `INVALID_CLUSTER` | Placement would violate the cluster rule        |
| `INVALID_BORDER`  | Border placement is not allowed here            |
| `NO_PIECE`        | No piece at the jump origin                     |
| `NOT_YOUR_PIECE`  | That piece belongs to your opponent             |
| `INVALID_JUMP`    | The jump is not legal from this position        |
| `NO_PENDING_JUMP` | No jump sequence in progress to confirm or undo |
