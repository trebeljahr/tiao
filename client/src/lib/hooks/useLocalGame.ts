import { useState, useCallback, useEffect, useRef } from "react";
import {
  createInitialGameState,
  GameSettings,
  Position,
  GameState,
  PlayerColor,
  TurnRecord,
  canPlacePiece,
  placePiece,
  getJumpTargets,
  jumpPiece,
  confirmPendingJump,
  undoLastTurn,
  undoPendingJumpStep,
  isGameOver,
} from "@shared";

// Detected at call time so unit tests can simulate a touch device by setting
// `navigator.maxTouchPoints` before invoking the click handler.
//
// We intentionally only look at `maxTouchPoints` and NOT `"ontouchstart" in
// window` — jsdom exposes the latter even though it is not really a touch
// environment, which would make every unit test look like mobile.  The
// behavior we're gating (fat-finger placement protection during a jump
// selection) only matters on devices with real touch input, and every modern
// mobile browser reports `maxTouchPoints > 0`.
function isTouchDevice() {
  return typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0;
}

export function useLocalGame(settings?: Partial<GameSettings>) {
  const [localGame, setLocalGame] = useState<GameState>(() => createInitialGameState(settings));
  const [localSelection, setLocalSelection] = useState<Position | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localScorePulse, setLocalScorePulse] = useState<Record<PlayerColor, number>>({
    black: 0,
    white: 0,
  });

  const [lastMove, setLastMove] = useState<TurnRecord | null>(null);
  const localHistoryLengthRef = useRef(localGame.history.length);

  useEffect(() => {
    // Find the last board move (skip meta-records like "win")
    const findLastBoardMove = (): TurnRecord | null => {
      for (let i = localGame.history.length - 1; i >= 0; i--) {
        const r = localGame.history[i];
        if (r.type === "put" || r.type === "jump") return r;
      }
      return null;
    };

    if (localGame.history.length > localHistoryLengthRef.current) {
      // Stamp timestamps on new move records (for clock restoration on undo)
      const now = Date.now();
      for (let i = localHistoryLengthRef.current; i < localGame.history.length; i++) {
        const rec = localGame.history[i];
        if ((rec.type === "put" || rec.type === "jump") && !rec.timestamp) {
          rec.timestamp = now;
        }
      }

      const lastBoardMove = findLastBoardMove();
      if (lastBoardMove) {
        setLocalScorePulse((prev) => ({
          ...prev,
          [localGame.currentTurn === "white" ? "black" : "white"]: Date.now(),
        }));
        setLastMove(lastBoardMove);
      }
    } else if (localGame.history.length < localHistoryLengthRef.current) {
      // History shrank (undo): update lastMove to reflect the new last turn
      setLastMove(findLastBoardMove());
    }
    localHistoryLengthRef.current = localGame.history.length;
  }, [localGame]);

  const resetLocalGame = useCallback(
    (overrides?: Partial<GameSettings>) => {
      setLocalGame(createInitialGameState(overrides ?? settings));
      setLocalSelection(null);
      setLocalError(null);
      setLastMove(null);
    },
    [settings],
  );

  const handleLocalConfirmPendingJump = useCallback(() => {
    const result = confirmPendingJump(localGame);
    if (result.ok) {
      setLocalGame(result.value);
      setLocalSelection(null);
      setLocalError(null);
    } else {
      setLocalError(result.reason);
    }
  }, [localGame]);

  const handleLocalBoardClick = useCallback(
    (position: Position) => {
      if (isGameOver(localGame)) {
        return;
      }

      setLocalError(null);

      const hasPending = localGame.pendingJump.length > 0;

      // During a pending jump, clicking the jump destination confirms.
      // This handles the case where localSelection was cleared by clicking
      // elsewhere and then clicking back on the jumping piece.
      if (hasPending) {
        const dest = localGame.pendingJump[localGame.pendingJump.length - 1].to;
        if (dest.x === position.x && dest.y === position.y) {
          handleLocalConfirmPendingJump();
          return;
        }
      }

      if (localSelection) {
        if (localSelection.x === position.x && localSelection.y === position.y) {
          if (hasPending) {
            handleLocalConfirmPendingJump();
          } else {
            setLocalSelection(null);
          }
          return;
        }

        const jumpTargets = getJumpTargets(localGame, localSelection);

        if (jumpTargets.some((t) => t.x === position.x && t.y === position.y)) {
          const result = jumpPiece(localGame, localSelection, position);
          if (result.ok) {
            setLocalGame(result.value);
            setLocalSelection(position);
          } else {
            setLocalError(result.reason);
          }
          return;
        }

        // On touch devices, when the selected piece has available jumps,
        // block any other action (placement or selecting a different piece)
        // to prevent accidental placements from fat-fingering.  On desktop,
        // clicking elsewhere is an intentional deselect (or a reselect if it
        // lands on another own piece with jumps), so we fall through.
        if (jumpTargets.length > 0 && isTouchDevice()) {
          return;
        }
      }

      // Don't allow selecting a different piece or placing during a pending
      // jump — the player must confirm or undo the current jump first.
      if (hasPending) {
        return;
      }

      const placement = canPlacePiece(localGame, position);
      if (placement.ok) {
        const result = placePiece(localGame, position);
        if (result.ok) {
          setLocalGame(result.value);
          setLocalSelection(null);
        } else {
          setLocalError(result.reason);
        }
        return;
      }

      const tile = localGame.positions[position.y]?.[position.x];
      if (tile === localGame.currentTurn && localGame.pendingJump.length === 0) {
        const jumpOrigins = getJumpTargets(localGame, position);
        if (jumpOrigins.length > 0) {
          setLocalSelection(position);
          return;
        }
      }

      setLocalSelection(null);
    },
    [localGame, localSelection, handleLocalConfirmPendingJump],
  );

  const handleLocalUndoPendingJump = useCallback(() => {
    const result = undoPendingJumpStep(localGame);
    if (result.ok) {
      setLocalGame(result.value);
      setLocalSelection(
        result.value.pendingJump.length > 0
          ? result.value.pendingJump[result.value.pendingJump.length - 1].to
          : null,
      );
      setLocalError(null);
    }
  }, [localGame]);

  const handleLocalUndoTurn = useCallback(() => {
    const result = undoLastTurn(localGame);
    if (result.ok) {
      setLocalGame(result.value);
      setLocalSelection(null);
      setLocalError(null);
    }
  }, [localGame]);

  const localJumpTargets = localSelection ? getJumpTargets(localGame, localSelection) : [];

  return {
    localGame,
    setLocalGame,
    localSelection,
    setLocalSelection,
    localError,
    setLocalError,
    localScorePulse,
    localJumpTargets,
    lastMove,
    setLastMove,
    resetLocalGame,
    handleLocalBoardClick,
    handleLocalConfirmPendingJump,
    handleLocalUndoPendingJump,
    handleLocalUndoTurn,
  };
}
