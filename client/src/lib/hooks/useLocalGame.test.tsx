import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalGame } from "./useLocalGame";
import { createInitialGameState, GameState, getJumpTargets } from "@shared";

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

describe("useLocalGame – stale closure fix for handleLocalConfirmPendingJump", () => {
  /**
   * Regression test for a stale-closure bug where handleLocalBoardClick's
   * dependency array did not include handleLocalConfirmPendingJump. This
   * caused the inline "click same piece to confirm" path to call
   * confirmPendingJump with a stale game state.
   *
   * The fix: handleLocalBoardClick's deps include handleLocalConfirmPendingJump.
   */
  it("confirms a pending jump correctly when triggered by re-clicking the selected piece", () => {
    const { result } = renderHook(() => useLocalGame());

    const jumpState = stateWithJumpOpportunity();
    act(() => result.current.setLocalGame(jumpState));

    // Select white piece at (5,5)
    act(() => result.current.handleLocalBoardClick({ x: 5, y: 5 }));
    expect(result.current.localSelection).toEqual({ x: 5, y: 5 });

    // Jump over black to (7,5)
    act(() => result.current.handleLocalBoardClick({ x: 7, y: 5 }));
    expect(result.current.localGame.pendingJump.length).toBe(1);
    expect(result.current.localGame.currentTurn).toBe("white");

    // Now the piece has landed at (7,5) and is selected there.
    // Re-click the same position to confirm via the inline path in
    // handleLocalBoardClick (the path that calls handleLocalConfirmPendingJump).
    // If the closure were stale, this would use the OLD game state (before
    // the jump) and confirmPendingJump would fail or produce wrong results.
    act(() => result.current.handleLocalBoardClick({ x: 7, y: 5 }));

    // After confirmation, turn should switch to black
    expect(result.current.localGame.currentTurn).toBe("black");
    // Pending jump should be cleared
    expect(result.current.localGame.pendingJump.length).toBe(0);
    // Selection should be cleared
    expect(result.current.localSelection).toBeNull();
  });

  it("confirms pending jump correctly even after intermediate state changes", () => {
    const { result } = renderHook(() => useLocalGame());

    // Start fresh — place some pieces first to evolve the game state
    // White places at (9,9)
    act(() => result.current.handleLocalBoardClick({ x: 9, y: 9 }));
    expect(result.current.localGame.currentTurn).toBe("black");

    // Black places at (9,10)
    act(() => result.current.handleLocalBoardClick({ x: 9, y: 10 }));
    expect(result.current.localGame.currentTurn).toBe("white");

    // Now set up a jump opportunity — game state has evolved through multiple changes
    const jumpState = stateWithJumpOpportunity();
    // Preserve existing history to simulate multiple state transitions
    jumpState.history = [...result.current.localGame.history];
    act(() => result.current.setLocalGame(jumpState));

    // Select and jump
    act(() => result.current.handleLocalBoardClick({ x: 5, y: 5 }));
    act(() => result.current.handleLocalBoardClick({ x: 7, y: 5 }));
    expect(result.current.localGame.pendingJump.length).toBe(1);

    // Confirm via handleLocalConfirmPendingJump directly — should use fresh state
    act(() => result.current.handleLocalConfirmPendingJump());
    expect(result.current.localGame.currentTurn).toBe("black");
    expect(result.current.localGame.pendingJump.length).toBe(0);
  });
});

describe("useLocalGame – lastMove tracking on undo", () => {
  it("clears lastMove when undoing the only move", () => {
    const { result } = renderHook(() => useLocalGame());

    // Place a piece — lastMove should be set
    act(() => result.current.handleLocalBoardClick({ x: 9, y: 9 }));
    expect(result.current.lastMove).not.toBeNull();
    expect(result.current.lastMove!.type).toBe("put");

    // Undo — lastMove should be null (no history left)
    act(() => result.current.handleLocalUndoTurn());
    expect(result.current.lastMove).toBeNull();
  });

  it("updates lastMove to the previous move when undoing", () => {
    const { result } = renderHook(() => useLocalGame());

    // White places
    act(() => result.current.handleLocalBoardClick({ x: 9, y: 9 }));
    const firstMove = result.current.lastMove;
    expect(firstMove).not.toBeNull();

    // Black places
    act(() => result.current.handleLocalBoardClick({ x: 8, y: 8 }));
    const secondMove = result.current.lastMove;
    expect(secondMove).not.toBeNull();
    expect(secondMove).not.toBe(firstMove);

    // Undo black's move — lastMove should revert to white's move
    act(() => result.current.handleLocalUndoTurn());
    expect(result.current.lastMove).not.toBeNull();
    expect(result.current.lastMove!.type).toBe("put");
    // Should match the first move (white's placement at 9,9)
    if (result.current.lastMove!.type === "put") {
      expect(result.current.lastMove!.position).toEqual({ x: 9, y: 9 });
    }
  });

  it("clears lastMove after multiple undos back to empty board", () => {
    const { result } = renderHook(() => useLocalGame());

    act(() => result.current.handleLocalBoardClick({ x: 9, y: 9 }));
    act(() => result.current.handleLocalBoardClick({ x: 8, y: 8 }));
    expect(result.current.lastMove).not.toBeNull();

    // Undo both moves
    act(() => result.current.handleLocalUndoTurn());
    expect(result.current.lastMove).not.toBeNull(); // still has white's move
    act(() => result.current.handleLocalUndoTurn());
    expect(result.current.lastMove).toBeNull(); // no moves left
  });

  it("sets lastMove correctly after undo then new placement", () => {
    const { result } = renderHook(() => useLocalGame());

    // Place and undo
    act(() => result.current.handleLocalBoardClick({ x: 9, y: 9 }));
    act(() => result.current.handleLocalUndoTurn());
    expect(result.current.lastMove).toBeNull();

    // Place again at different position
    act(() => result.current.handleLocalBoardClick({ x: 7, y: 7 }));
    expect(result.current.lastMove).not.toBeNull();
    if (result.current.lastMove!.type === "put") {
      expect(result.current.lastMove!.position).toEqual({ x: 7, y: 7 });
    }
  });
});

describe("useLocalGame – placement blocked when piece with jump is selected", () => {
  it("prevents placing a stone when a piece with available jumps is selected", () => {
    const { result } = renderHook(() => useLocalGame());

    const jumpState = stateWithJumpOpportunity();
    act(() => result.current.setLocalGame(jumpState));

    // Select white piece at (5,5) — it can jump over black at (6,5)
    act(() => result.current.handleLocalBoardClick({ x: 5, y: 5 }));
    expect(result.current.localSelection).toEqual({ x: 5, y: 5 });
    expect(result.current.localJumpTargets.length).toBeGreaterThan(0);

    // Try to place at (9,9) — an empty cell far away.
    // This should be blocked because the selected piece has jump targets.
    act(() => result.current.handleLocalBoardClick({ x: 9, y: 9 }));
    expect(result.current.localGame.positions[9][9]).toBeNull();

    // Selection should still be active (not cleared)
    expect(result.current.localSelection).toEqual({ x: 5, y: 5 });
  });

  it("allows placement when no piece with jumps is selected", () => {
    const { result } = renderHook(() => useLocalGame());

    // On a fresh board, no pieces can jump. Place normally.
    act(() => result.current.handleLocalBoardClick({ x: 9, y: 9 }));
    expect(result.current.localGame.positions[9][9]).toBe("white");
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
