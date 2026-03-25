import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalGame } from "./useLocalGame";
import {
  createInitialGameState,
  placePiece,
  GameState,
  getJumpTargets,
} from "@shared";

/**
 * Helper: build a game state where white and black pieces are positioned
 * such that the current player can jump an opponent's piece.
 *
 * Board layout (center area):
 *   (5,5) = white
 *   (6,5) = black
 *   (7,5) = empty  <-- white can jump over black to land here
 *
 * currentTurn = "white"
 */
function stateWithJumpOpportunity(): GameState {
  const state = createInitialGameState();
  state.positions[5][5] = "white";
  state.positions[5][6] = "black";
  // (7,5) is empty — white at (5,5) can jump over black at (6,5) to (7,5)
  return state;
}

describe("useLocalGame – turn alternation", () => {
  it("starts with white to move", () => {
    const { result } = renderHook(() => useLocalGame());
    expect(result.current.localGame.currentTurn).toBe("white");
  });

  it("alternates turn after placement", () => {
    const { result } = renderHook(() => useLocalGame());

    // White places at (9,9) — center of the board, always legal
    act(() => result.current.handleLocalBoardClick({ x: 9, y: 9 }));
    expect(result.current.localGame.currentTurn).toBe("black");

    // Black places at (9,10)
    act(() => result.current.handleLocalBoardClick({ x: 9, y: 10 }));
    expect(result.current.localGame.currentTurn).toBe("white");
  });

  it("does NOT allow selecting an opponent piece for jumping", () => {
    const { result } = renderHook(() => useLocalGame());

    // Set up a state where it's white's turn with pieces on the board
    const jumpState = stateWithJumpOpportunity();
    // It's white's turn; black piece is at (6,5)
    act(() => result.current.setLocalGame(jumpState));

    // Try to click on the BLACK piece at (6,5) — should NOT select it
    act(() => result.current.handleLocalBoardClick({ x: 6, y: 5 }));
    expect(result.current.localSelection).toBeNull();
    expect(result.current.localJumpTargets).toEqual([]);
  });

  it("allows selecting own piece for jumping", () => {
    const { result } = renderHook(() => useLocalGame());

    const jumpState = stateWithJumpOpportunity();
    act(() => result.current.setLocalGame(jumpState));

    // Click on the WHITE piece at (5,5) — should select it
    act(() => result.current.handleLocalBoardClick({ x: 5, y: 5 }));
    expect(result.current.localSelection).toEqual({ x: 5, y: 5 });
    expect(result.current.localJumpTargets.length).toBeGreaterThan(0);
  });

  it("does NOT show jump targets for the wrong color", () => {
    const { result } = renderHook(() => useLocalGame());

    // Set up state: white's turn, black has a jumpable piece layout
    const state = createInitialGameState();
    state.positions[5][5] = "black"; // black piece
    state.positions[5][6] = "white"; // white piece adjacent
    // black at (5,5) could jump white at (6,5) to (7,5) IF it were black's turn
    // But it's white's turn, so clicking black piece should not work
    act(() => result.current.setLocalGame(state));

    act(() => result.current.handleLocalBoardClick({ x: 5, y: 5 }));
    // Should NOT select black's piece on white's turn
    expect(result.current.localSelection).toBeNull();
  });

  it("alternates turn after a complete jump sequence", () => {
    const { result } = renderHook(() => useLocalGame());

    const jumpState = stateWithJumpOpportunity();
    act(() => result.current.setLocalGame(jumpState));

    expect(result.current.localGame.currentTurn).toBe("white");

    // Select white piece
    act(() => result.current.handleLocalBoardClick({ x: 5, y: 5 }));
    expect(result.current.localSelection).toEqual({ x: 5, y: 5 });

    // Jump over black to (7,5)
    act(() => result.current.handleLocalBoardClick({ x: 7, y: 5 }));
    // Should now have a pending jump
    expect(result.current.localGame.pendingJump.length).toBe(1);
    // Still white's turn until confirmed
    expect(result.current.localGame.currentTurn).toBe("white");

    // Confirm the jump
    act(() => result.current.handleLocalConfirmPendingJump());
    // Now it should be black's turn
    expect(result.current.localGame.currentTurn).toBe("black");
  });
});

describe("getJumpTargets – color parameter", () => {
  it("defaults to the piece color at the position", () => {
    const state = stateWithJumpOpportunity();
    // White at (5,5), black at (6,5), empty at (7,5)
    const targets = getJumpTargets(state, { x: 5, y: 5 });
    expect(targets).toContainEqual({ x: 7, y: 5 });
  });

  it("returns empty for a position with no piece when no color given", () => {
    const state = stateWithJumpOpportunity();
    const targets = getJumpTargets(state, { x: 7, y: 5 });
    expect(targets).toEqual([]);
  });

  it("returns empty when explicitly passing wrong color for a piece", () => {
    const state = stateWithJumpOpportunity();
    // White piece at (5,5) — passing "black" means it looks for non-black neighbors
    // which would be the white piece itself, but the function checks middlePiece !== color
    // so passing "black" with white at (5,5) would find white at (6,5)... but (6,5) is black
    // Let's verify the actual behavior: white at (5,5) jumping over black at (6,5) with color="black"
    // middlePiece (black) === color (black) → skip. So no targets.
    const targets = getJumpTargets(state, { x: 5, y: 5 }, "black");
    expect(targets).toEqual([]);
  });
});
