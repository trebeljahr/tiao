# Mobile Stone Placement

## Problem

On mobile devices, Tiao's 19x19 board renders intersections at roughly 20px apart. This makes precise stone placement difficult — fingers occlude the target area and small errors in tap position can land a stone on the wrong intersection. This is frustrating because misplaced stones cannot be taken back in multiplayer games.

## Decision

We implemented a **tap-to-preview + tap-to-confirm** pattern on mobile. First tap on an empty intersection shows a semi-transparent ghost stone preview with a "Tap to place" label and pulsing confirmation ring. Tapping the same position again confirms the placement. Tapping a different empty intersection moves the preview there instead.

When tapping on a position that already has a piece, or when there's an active selection (for jump moves), the tap goes through directly without the preview step, since those interactions are unambiguous.

Desktop behavior is completely unchanged — single clicks place stones immediately with no preview.

## Alternatives Considered

### 1. Tap-to-Preview + Tap-to-Confirm

First tap shows a ghost stone preview, second tap confirms placement.

- **Pro**: Dead simple, zero learning curve, works identically everywhere
- **Con**: Every placement requires two taps, slowing down gameplay significantly. Doesn't solve the fundamental "can't see under my finger" problem.

### 2. Offset Crosshair

Touch target is shifted ~40px above the finger. A ghost stone shows where the stone will actually land.

- **Pro**: Lightweight, single-gesture
- **Con**: Feels disconnected — you're touching one spot but affecting another. Top row becomes unreachable. Unintuitive for first-time users.

### 3. Zoom-into-Quadrant

Tapping a region of the board zooms into that area, showing a 5x5 region with larger intersections.

- **Pro**: Very precise placement
- **Con**: Two-step process, loses full board context during placement, feels jarring.

### 4. Touch-Drag Loupe (always-on)

Loupe appears on every touch, with quick taps placing immediately.

- **Pro**: No discovery problem
- **Con**: Loupe flashing on every quick tap is visually noisy. Quick taps still have the fat-finger problem.

## How It Works

### Touch Event Flow

1. **`touchstart`**: Records the touch position and starts a 120ms timer
2. **Timer fires** (finger still held): Activates the loupe — snaps to nearest grid intersection, renders the magnified bubble above the finger
3. **`touchmove`** (while loupe active): Updates the loupe position, snapping to the nearest intersection. Calls `preventDefault()` to stop page scroll.
4. **`touchmove`** (before timer fires, > 10px movement): Cancels the timer — user is scrolling, not holding
5. **`touchend`** (loupe active): Places stone at the snapped intersection via `onPointClick()`, clears all loupe state
6. **`touchend`** (loupe not active, < 120ms): Normal click handler fires — quick tap places immediately

### Loupe Rendering

The loupe is a 120px diameter circle rendered as a lightweight SVG:

- Grid lines (same visual style as the main board)
- Star points
- Existing stones from game state
- A ghost stone at the snapped intersection showing what will be placed
- An orange crosshair ring around the target intersection
- A small caret triangle pointing down toward the user's finger

The SVG uses a dynamic `viewBox` centered on the target position, providing natural ~3x magnification without CSS transforms.

### Position Calculation

Touch coordinates are converted to board-relative percentages, then snapped to the nearest grid intersection:

```
gridIndex = round((touchPercent - GRID_START) / GRID_STEP)
clampedIndex = clamp(gridIndex, 0, BOARD_SIZE - 1)
```

### Edge Cases

- **Loupe near top of board**: If the loupe would go off-screen above, it renders below the finger instead
- **Board disabled**: Loupe won't activate (opponent's turn, game over)
- **State changes**: Loupe automatically clears when turn switches, history updates, or board becomes disabled
- **Horizontal clamping**: Loupe stays within board bounds horizontally

### Touch Detection

Uses a simple check at module load time:

```typescript
const IS_TOUCH_DEVICE =
  typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
```

This gates both the loupe behavior and suppresses desktop-only hover ghosts on touch devices.

## Trade-offs

- **Discovery**: Touch-and-hold is a familiar mobile pattern (iOS text editing, Telegram) but isn't visually indicated. Users who only quick-tap will never see the loupe. This is acceptable because quick taps still work, and the loupe is a precision aid rather than a required interaction.
- **120ms threshold**: Balances between activating too eagerly (interfering with scrolls) and too slowly (feeling unresponsive). This matches iOS's own touch-and-hold timing.
- **SVG re-rendering**: The loupe renders a simplified copy of the board as SVG on each position update. This is lightweight (just lines + circles) and doesn't cause performance issues on modern mobile devices.
