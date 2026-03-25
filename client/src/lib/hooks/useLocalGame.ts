import { useState, useCallback, useEffect, useRef } from "react";
import {
  createInitialGameState,
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

export function useLocalGame() {
  const [localGame, setLocalGame] = useState<GameState>(() =>
    createInitialGameState(),
  );
  const [localSelection, setLocalSelection] = useState<Position | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localScorePulse, setLocalScorePulse] = useState<
    Record<PlayerColor, number>
  >({ black: 0, white: 0 });

  const [lastMove, setLastMove] = useState<TurnRecord | null>(null);
  const localHistoryLengthRef = useRef(localGame.history.length);

  useEffect(() => {
    if (localGame.history.length > localHistoryLengthRef.current) {
      const lastTurn = localGame.history[localGame.history.length - 1];
      if (lastTurn.type === "place" || lastTurn.type === "confirm-jump") {
        setLocalScorePulse((prev) => ({
          ...prev,
          [localGame.currentTurn === "white" ? "black" : "white"]: Date.now(),
        }));
        setLastMove(lastTurn);
      }
    }
    localHistoryLengthRef.current = localGame.history.length;
  }, [localGame]);

  const resetLocalGame = useCallback(() => {
    setLocalGame(createInitialGameState());
    setLocalSelection(null);
    setLocalError(null);
    setLastMove(null);
  }, []);

  const handleLocalBoardClick = useCallback(
    (position: Position) => {
      if (isGameOver(localGame)) {
        return;
      }

      setLocalError(null);

      if (localSelection) {
        if (
          localSelection.x === position.x &&
          localSelection.y === position.y
        ) {
          if (localGame.pendingJump.length > 0) {
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
      if (tile === localGame.currentTurn) {
        const jumpOrigins = getJumpTargets(localGame, position);
        if (jumpOrigins.length > 0) {
          setLocalSelection(position);
          return;
        }
      }

      setLocalSelection(null);
    },
    [localGame, localSelection],
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

  const handleLocalUndoPendingJump = useCallback(() => {
    const result = undoPendingJumpStep(localGame);
    if (result.ok) {
      setLocalGame(result.value);
      setLocalSelection(
        result.value.pendingJump.length > 0
          ? result.value.pendingJump[result.value.pendingJump.length - 1]
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

  const localJumpTargets = localSelection
    ? getJumpTargets(localGame, localSelection)
    : [];

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
