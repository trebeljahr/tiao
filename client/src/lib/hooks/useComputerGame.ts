import { useState, useEffect, useCallback, useRef } from "react";
import { isGameOver, type TurnRecord } from "@shared";
import { useLocalGame } from "./useLocalGame";
import {
  COMPUTER_COLOR,
  COMPUTER_THINK_MS,
  requestComputerMove,
  applyComputerTurnPlan,
  type AIDifficulty,
} from "../computer-ai";

const AI_LINGER_MS = 600;

export function useComputerGame(difficulty: AIDifficulty = 3) {
  const local = useLocalGame();
  const [computerThinking, setComputerThinking] = useState(false);
  const [thinkProgress, setThinkProgress] = useState(0);
  const [lastMove, setLastMove] = useState<TurnRecord | null>(null);

  // Track the game history length that triggered the current search.
  // This prevents re-triggering for the same position and handles strict mode:
  // cleanup doesn't need to reset computerThinking because the ref guards re-entry.
  const searchedForRef = useRef(-1);

  const needsMove =
    !isGameOver(local.localGame) &&
    local.localGame.currentTurn === COMPUTER_COLOR;

  useEffect(() => {
    if (!needsMove) {
      searchedForRef.current = -1;
      return;
    }

    // Don't re-trigger if we already started a search for this game state
    const histLen = local.localGame.history.length;
    if (searchedForRef.current === histLen) return;
    searchedForRef.current = histLen;

    setComputerThinking(true);
    setThinkProgress(0);
    let cancelled = false;
    const startTime = Date.now();
    const gameAtRequest = local.localGame;

    const { promise, cancel } = requestComputerMove(
      gameAtRequest,
      difficulty,
      (progress) => {
        if (!cancelled) setThinkProgress(progress);
      },
    );

    promise
      .then((plan) => {
        if (cancelled) return;
        if (!plan) {
          setComputerThinking(false);
          setThinkProgress(0);
          searchedForRef.current = -1;
          return;
        }

        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, COMPUTER_THINK_MS - elapsed);

        setTimeout(() => {
          if (cancelled) return;

          const result = applyComputerTurnPlan(gameAtRequest, plan);
          if (result.ok) {
            const newHistory = result.value.history;
            const lastTurn = newHistory[newHistory.length - 1] ?? null;
            setLastMove(lastTurn);
            local.setLocalGame(result.value);
            local.setLocalSelection(null);
            local.setLocalError(null);

            setTimeout(() => {
              if (cancelled) return;
              setComputerThinking(false);
              setThinkProgress(0);
            }, AI_LINGER_MS);
          } else {
            local.setLocalError(result.reason);
            setComputerThinking(false);
            setThinkProgress(0);
          }
        }, remaining);
      })
      .catch(() => {
        if (!cancelled) {
          setComputerThinking(false);
          setThinkProgress(0);
          searchedForRef.current = -1;
        }
      });

    return () => {
      cancelled = true;
      cancel();
      // Reset the guard so a fresh effect run can re-trigger for the same position
      searchedForRef.current = -1;
    };
  }, [needsMove, local.localGame, difficulty]);

  const handleBoardClick = useCallback(
    (position: any) => {
      if (computerThinking || local.localGame.currentTurn === COMPUTER_COLOR) {
        return;
      }
      setLastMove(null);
      local.handleLocalBoardClick(position);
    },
    [
      computerThinking,
      local.localGame.currentTurn,
      local.handleLocalBoardClick,
    ],
  );

  return {
    ...local,
    computerThinking,
    thinkProgress,
    lastMove,
    handleLocalBoardClick: handleBoardClick,
    controlsDisabled:
      computerThinking || local.localGame.currentTurn === COMPUTER_COLOR,
  };
}
