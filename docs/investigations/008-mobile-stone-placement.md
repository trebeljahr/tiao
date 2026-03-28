# Investigation: Mobile Stone Placement UX

**Status:** Decided
**Date:** Iterated across multiple commits (2025-2026)

## Context

Placing stones accurately on a Go-like board is difficult on mobile touchscreens. Fingers occlude the target intersection, and fat-finger errors are common on smaller boards. Multiple approaches were prototyped and tested.

## Approaches Tried

### Magnifying Loupe

- A magnified circular view showing the area under the finger
- **Rejected** — felt clunky in practice, added visual noise, didn't solve the fundamental occlusion problem well enough

### Direct Tap (desktop-style)

- Tap intersection to place stone immediately
- Works fine on desktop, too error-prone on mobile without zoom

### Pinch-to-Zoom + Crosshair Overlay

- Users zoom into the board area they want to play
- A crosshair overlay shows the exact target intersection
- Natural mobile gesture, gives precision when zoomed in

### Double-Tap Placement

- Tried as a quick-place mechanism when already zoomed in
- **Removed** — confusing interaction model, inconsistent with the rest of the UX

### Ghost Stone + Tap-to-Confirm (chosen)

- Tapping an intersection shows a semi-transparent "ghost" stone preview
- A second tap (or confirm button) places the stone
- Cancel button to deselect
- Combined with pinch-to-zoom and drag-to-adjust

## Outcome

The final UX combines:

1. **Pinch-to-zoom** for precision on small boards
2. **Ghost stone preview** on first tap — shows where the stone will go
3. **Tap-to-confirm** — second tap or quick-tap anywhere to confirm placement
4. **Cancel** — tap the cancel button or tap elsewhere to deselect

This two-step interaction prevents accidental placements while remaining fast enough for timed games. The magnifier loupe was the most visually interesting approach but the least practical.
