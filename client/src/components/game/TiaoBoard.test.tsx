import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createInitialGameState, BOARD_SIZE } from "@shared";
import { touchToGridPosition } from "./TiaoBoard";

// ---------- touchToGridPosition unit tests ----------

describe("touchToGridPosition", () => {
  const GRID_START = 100 / (BOARD_SIZE * 2);
  const GRID_SPAN = 100 - 2 * GRID_START;
  const GRID_STEP = GRID_SPAN / (BOARD_SIZE - 1);

  function makeRect(width: number, height: number): DOMRect {
    return {
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect;
  }

  it("snaps center of board to (9,9)", () => {
    const rect = makeRect(400, 400);
    // Center of a 400px board → 50% in both axes
    const pos = touchToGridPosition(200, 200, rect);
    expect(pos.x).toBe(9);
    expect(pos.y).toBe(9);
  });

  it("snaps to (0,0) near top-left corner", () => {
    const rect = makeRect(400, 400);
    // GRID_START% of 400px = position of intersection (0,0)
    const px = (GRID_START / 100) * 400;
    const pos = touchToGridPosition(px, px, rect);
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  it("snaps to (18,18) near bottom-right corner", () => {
    const rect = makeRect(400, 400);
    const gridEnd = 100 - GRID_START;
    const px = (gridEnd / 100) * 400;
    const pos = touchToGridPosition(px, px, rect);
    expect(pos.x).toBe(18);
    expect(pos.y).toBe(18);
  });

  it("clamps negative coordinates to (0,0)", () => {
    const rect = makeRect(400, 400);
    const pos = touchToGridPosition(-50, -50, rect);
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  it("clamps coordinates beyond board to (18,18)", () => {
    const rect = makeRect(400, 400);
    const pos = touchToGridPosition(500, 500, rect);
    expect(pos.x).toBe(18);
    expect(pos.y).toBe(18);
  });

  it("snaps to nearest intersection, not floor", () => {
    const rect = makeRect(400, 400);
    // Position slightly past intersection (3,3)
    const target3 = GRID_START + GRID_STEP * 3;
    const slightlyPast = ((target3 + GRID_STEP * 0.3) / 100) * 400;
    const pos = touchToGridPosition(slightlyPast, slightlyPast, rect);
    expect(pos.x).toBe(3);
    expect(pos.y).toBe(3);
  });

  it("handles non-square boards (rect offset)", () => {
    const rect = {
      left: 100,
      top: 50,
      right: 500,
      bottom: 450,
      width: 400,
      height: 400,
      x: 100,
      y: 50,
      toJSON: () => {},
    } as DOMRect;
    // Touch at rect center → (9,9)
    const pos = touchToGridPosition(300, 250, rect);
    expect(pos.x).toBe(9);
    expect(pos.y).toBe(9);
  });
});

// ---------- TiaoBoard component tests ----------

// We need to dynamically import TiaoBoard after potentially mocking touch detection.
// Since IS_TOUCH_DEVICE is evaluated at module load, we use vi.hoisted + dynamic import.

describe("TiaoBoard – desktop behavior (no touch)", () => {
  it("calls onPointClick immediately on click", async () => {
    // Default environment has no touch support, so IS_TOUCH_DEVICE = false
    const { TiaoBoard } = await import("./TiaoBoard");
    const onPointClick = vi.fn();
    const state = createInitialGameState();

    render(
      <TiaoBoard state={state} selectedPiece={null} jumpTargets={[]} onPointClick={onPointClick} />,
    );

    const cell = screen.getByTestId("cell-9-9");
    fireEvent.click(cell);

    expect(onPointClick).toHaveBeenCalledWith({ x: 9, y: 9 });
    expect(onPointClick).toHaveBeenCalledTimes(1);
  });

  it("does not render loupe element on desktop click", async () => {
    const { TiaoBoard } = await import("./TiaoBoard");
    const state = createInitialGameState();

    render(
      <TiaoBoard state={state} selectedPiece={null} jumpTargets={[]} onPointClick={() => {}} />,
    );

    const cell = screen.getByTestId("cell-9-9");
    fireEvent.click(cell);

    // No loupe should be rendered
    const board = screen.getByTestId("tiao-board");
    expect(board.querySelector('[class*="z-[100]"]')).toBeNull();
  });
});

describe("TiaoBoard – disabled state", () => {
  it("does not call onPointClick when disabled", async () => {
    const { TiaoBoard } = await import("./TiaoBoard");
    const onPointClick = vi.fn();
    const state = createInitialGameState();

    render(
      <TiaoBoard
        state={state}
        selectedPiece={null}
        jumpTargets={[]}
        disabled={true}
        onPointClick={onPointClick}
      />,
    );

    const cell = screen.getByTestId("cell-9-9");
    fireEvent.click(cell);

    // Button is disabled, so click doesn't propagate to handler
    expect(onPointClick).not.toHaveBeenCalled();
  });
});

describe("TiaoBoard – board testid", () => {
  it("renders with data-testid tiao-board", async () => {
    const { TiaoBoard } = await import("./TiaoBoard");
    const state = createInitialGameState();

    render(
      <TiaoBoard state={state} selectedPiece={null} jumpTargets={[]} onPointClick={() => {}} />,
    );

    expect(screen.getByTestId("tiao-board")).toBeTruthy();
  });
});

describe("TiaoBoard – last move highlighting", () => {
  it("renders gold border for last put move position", async () => {
    const { TiaoBoard } = await import("./TiaoBoard");
    const state = createInitialGameState();
    // Place a piece at (9,9) so the highlight has something to highlight
    state.positions[9][9] = "white";

    const lastMove = {
      type: "put" as const,
      color: "white" as const,
      position: { x: 9, y: 9 },
    };

    const { container } = render(
      <TiaoBoard
        state={state}
        selectedPiece={null}
        jumpTargets={[]}
        lastMove={lastMove}
        onPointClick={() => {}}
        disabled
      />,
    );

    // The cell at (9,9) should be marked as last move
    const cell = screen.getByTestId("cell-9-9");
    expect(cell.dataset.lastMove).toBeTruthy();
  });

  it("renders jump trail arrows for last jump move", async () => {
    const { TiaoBoard } = await import("./TiaoBoard");
    const state = createInitialGameState();
    // Place piece at the jump destination
    state.positions[8][8] = "black";

    const lastMove = {
      type: "jump" as const,
      color: "black" as const,
      jumps: [
        {
          from: { x: 10, y: 10 },
          over: { x: 9, y: 9 },
          to: { x: 8, y: 8 },
          color: "black" as const,
        },
      ],
    };

    const { container } = render(
      <TiaoBoard
        state={state}
        selectedPiece={null}
        jumpTargets={[]}
        lastMove={lastMove}
        onPointClick={() => {}}
        disabled
      />,
    );

    // Should render SVG lines for the jump trail with gold color
    const board = screen.getByTestId("tiao-board");
    const svgOverlay = board.querySelectorAll("svg")[1]; // Second SVG is the overlay
    expect(svgOverlay).toBeTruthy();

    // Check for blue-colored arrow lines (stroke="#4a8ac4" or stroke="#365f8a")
    const blueLines = svgOverlay.querySelectorAll('line[stroke="#4a8ac4"], line[stroke="#365f8a"]');
    expect(blueLines.length).toBeGreaterThan(0);
  });

  it("does not render jump trail arrows when lastMove is undefined", async () => {
    const { TiaoBoard } = await import("./TiaoBoard");
    const state = createInitialGameState();

    const { container } = render(
      <TiaoBoard
        state={state}
        selectedPiece={null}
        jumpTargets={[]}
        onPointClick={() => {}}
        disabled
      />,
    );

    const board = screen.getByTestId("tiao-board");
    const svgOverlay = board.querySelectorAll("svg")[1];
    // No gold lines should exist
    const goldLines = svgOverlay?.querySelectorAll('line[stroke="#c4963c"]') ?? [];
    expect(goldLines.length).toBe(0);
  });
});

describe("TiaoBoard – pending jump controls", () => {
  function makeStateWithPendingJump() {
    const state = createInitialGameState();
    // Set up a board position with a pending jump: white piece jumped from (9,9) over (9,8) to (9,7)
    state.positions[9][9] = null;
    state.positions[8][9] = "black"; // jumped over
    state.positions[7][9] = "white"; // landed
    state.pendingJump = [
      { from: { x: 9, y: 9 }, over: { x: 9, y: 8 }, to: { x: 9, y: 7 }, color: "white" },
    ];
    state.pendingCaptures = [{ x: 9, y: 8 }];
    return state;
  }

  it("renders undo button when there is a pending jump", async () => {
    const { TiaoBoard } = await import("./TiaoBoard");
    const state = makeStateWithPendingJump();
    const onUndoLastJump = vi.fn();
    const onConfirmJump = vi.fn();

    render(
      <TiaoBoard
        state={state}
        selectedPiece={{ x: 9, y: 7 }}
        jumpTargets={[]}
        onPointClick={() => {}}
        onUndoLastJump={onUndoLastJump}
        onConfirmJump={onConfirmJump}
      />,
    );

    const undoButtons = screen.getAllByLabelText("Undo last jump");
    expect(undoButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("calls onUndoLastJump when undo button is clicked", async () => {
    const { TiaoBoard } = await import("./TiaoBoard");
    const state = makeStateWithPendingJump();
    const onUndoLastJump = vi.fn();
    const onConfirmJump = vi.fn();

    render(
      <TiaoBoard
        state={state}
        selectedPiece={{ x: 9, y: 7 }}
        jumpTargets={[]}
        onPointClick={() => {}}
        onUndoLastJump={onUndoLastJump}
        onConfirmJump={onConfirmJump}
      />,
    );

    const undoButtons = screen.getAllByLabelText("Undo last jump");
    fireEvent.click(undoButtons[0]);
    expect(onUndoLastJump).toHaveBeenCalledTimes(1);
  });

  it("does not render pending jump controls when there is no pending jump", async () => {
    const { TiaoBoard } = await import("./TiaoBoard");
    const state = createInitialGameState();

    render(
      <TiaoBoard
        state={state}
        selectedPiece={null}
        jumpTargets={[]}
        onPointClick={() => {}}
        onUndoLastJump={() => {}}
        onConfirmJump={() => {}}
      />,
    );

    expect(screen.queryByLabelText("Undo last jump")).toBeNull();
    expect(screen.queryByLabelText("Confirm jump")).toBeNull();
  });
});

describe("TiaoBoard – crosshair overlay", () => {
  it("does not render crosshair on desktop (non-touch)", async () => {
    const { TiaoBoard } = await import("./TiaoBoard");
    const state = createInitialGameState();

    render(
      <TiaoBoard state={state} selectedPiece={null} jumpTargets={[]} onPointClick={() => {}} />,
    );

    const board = screen.getByTestId("tiao-board");
    // Crosshair SVG has z-[35] class — should not exist on desktop
    expect(board.querySelector('[class*="z-[35]"]')).toBeNull();
  });
});
