import { useState, useEffect, useCallback, useRef } from "react";
import type { PlayerColor, Position } from "@shared";
import {
  isGameOver,
  undoLastTurn,
  jumpPiece,
  placePiece,
  confirmPendingJump,
} from "@shared";
import { useLocalGame } from "./useLocalGame";
import {
  COMPUTER_THINK_MS,
  randomComputerColor,
  requestComputerMove,
  type AIDifficulty,
  type ComputerTurnPlan,
} from "../computer-ai";
import type { GameState } from "@shared";

const AI_LINGER_MS = 600;
const AI_JUMP_STEP_MS = 350;

export function useComputerGame(difficulty: AIDifficulty = 3) {
  const local = useLocalGame();
  const [computerColor, setComputerColor] = useState<PlayerColor>(randomComputerColor);
  const [computerThinking, setComputerThinking] = useState(false);
  const [thinkProgress, setThinkProgress] = useState(0);

  // Track the game history length that triggered the current search.
  // This prevents re-triggering for the same position and handles strict mode:
  // cleanup doesn't need to reset computerThinking because the ref guards re-entry.
  const searchedForRef = useRef(-1);

  // Ref to cancel the current AI operation (search + timeouts)
  const cancelRef = useRef<(() => void) | null>(null);

  // Stores the game state before the AI started its turn, so undo can
  // safely restore it even if the AI is mid-animation with pending jumps.
  const preAIStateRef = useRef<GameState | null>(null);

  const needsMove =
    !isGameOver(local.localGame) &&
    local.localGame.currentTurn === computerColor;

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
    const cancelledRef = { current: false };
    const startTime = Date.now();
    const gameAtRequest = local.localGame;

    // Save the pre-AI state so undo can restore it.
    // Only set if not already set — during animation, state updates
    // cause the effect to re-run and we must preserve the ORIGINAL
    // pre-AI state, not an intermediate animation state.
    if (!preAIStateRef.current) {
      preAIStateRef.current = gameAtRequest;
    }

    const { promise, cancel: cancelWorker } = requestComputerMove(
      gameAtRequest,
      difficulty,
      (progress) => {
        if (!cancelledRef.current) setThinkProgress(progress);
      },
      computerColor,
    );

    const doCancel = () => {
      cancelledRef.current = true;
      cancelWorker();
      setComputerThinking(false);
      setThinkProgress(0);
    };

    cancelRef.current = doCancel;

    promise
      .then(async (plan) => {
        if (cancelledRef.current || !plan) {
          if (!cancelledRef.current) {
            setComputerThinking(false);
            setThinkProgress(0);
            searchedForRef.current = -1;
            cancelRef.current = null;
            preAIStateRef.current = null;
          }
          return;
        }

        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, COMPUTER_THINK_MS - elapsed);

        await sleep(remaining);
        if (cancelledRef.current) return;

        // Animate the plan step by step
        const finalState = await animatePlan(
          gameAtRequest,
          plan,
          cancelledRef,
          (state) => {
            if (!cancelledRef.current) {
              local.setLocalGame(state);
              local.setLocalSelection(null);
              local.setLocalError(null);
            }
          },
        );

        if (cancelledRef.current) return;

        if (!finalState) {
          setComputerThinking(false);
          setThinkProgress(0);
          searchedForRef.current = -1;
          cancelRef.current = null;
          preAIStateRef.current = null;
          return;
        }

        await sleep(AI_LINGER_MS);
        if (cancelledRef.current) return;

        setComputerThinking(false);
        setThinkProgress(0);
        cancelRef.current = null;
        preAIStateRef.current = null;
      })
      .catch(() => {
        if (!cancelledRef.current) {
          setComputerThinking(false);
          setThinkProgress(0);
          searchedForRef.current = -1;
          cancelRef.current = null;
          preAIStateRef.current = null;
        }
      });

    return () => {
      doCancel();
      cancelRef.current = null;
    };
  }, [needsMove, local.localGame, difficulty, computerColor]);

  const handleBoardClick = useCallback(
    (position: Position) => {
      if (computerThinking || local.localGame.currentTurn === computerColor) {
        return;
      }
      local.handleLocalBoardClick(position);
    },
    [
      computerThinking,
      computerColor,
      local.localGame.currentTurn,
      local.handleLocalBoardClick,
    ],
  );

  // Undo for AI games: cancel AI thinking if active, then undo moves
  // until it's the player's turn again.
  const handleUndoForAI = useCallback(() => {
    // 1. Cancel any in-flight AI operation and reset search guard
    //    so the effect can re-trigger for the new (undone) state.
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    searchedForRef.current = -1;

    // 2. If preAIStateRef is set, the AI was mid-turn (thinking or
    //    animating). The current localGame may be an intermediate state
    //    with pending jumps that undoLastTurn would reject. Restore to
    //    the clean pre-AI snapshot instead.
    //    Note: we check preAIStateRef rather than cancelRef because
    //    React effect cleanup may have already cleared cancelRef during
    //    a re-render triggered by animation state updates.
    const restoredFromSnapshot = preAIStateRef.current !== null;
    let state: GameState;
    if (preAIStateRef.current) {
      state = preAIStateRef.current;
      preAIStateRef.current = null;
    } else {
      state = local.localGame;
    }

    // 3. If we're using the live state (AI already finished its turn)
    //    and it's the player's turn, undo the AI's move first.
    //    If we restored from the snapshot, the AI hadn't committed
    //    anything so skip this step.
    if (!restoredFromSnapshot && state.currentTurn !== computerColor && state.history.length > 0) {
      const undoAI = undoLastTurn(state);
      if (undoAI.ok) {
        state = undoAI.value;
      }
    }

    // 4. Now undo the player's last move
    if (state.history.length > 0) {
      const undoPlayer = undoLastTurn(state);
      if (undoPlayer.ok) {
        state = undoPlayer.value;
      }
    }

    local.setLocalGame(state);
    local.setLocalSelection(null);
    local.setLocalError(null);
  }, [local.localGame, computerColor, local.setLocalGame, local.setLocalSelection, local.setLocalError]);

  const resetComputerGame = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    preAIStateRef.current = null;
    setComputerColor(randomComputerColor());
    local.resetLocalGame();
  }, [local.resetLocalGame]);

  return {
    ...local,
    computerColor,
    computerThinking,
    thinkProgress,
    handleLocalBoardClick: handleBoardClick,
    handleLocalUndoTurn: handleUndoForAI,
    resetLocalGame: resetComputerGame,
    controlsDisabled:
      computerThinking || local.localGame.currentTurn === computerColor,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Animate a computer turn plan step by step.
 * For placements, applies immediately.
 * For multi-jump sequences, shows each hop with a delay.
 */
async function animatePlan(
  state: GameState,
  plan: ComputerTurnPlan,
  cancelledRef: { current: boolean },
  onUpdate: (state: GameState) => void,
): Promise<GameState | null> {
  if (plan.type === "place") {
    if (cancelledRef.current) return null;
    const result = placePiece(state, plan.position);
    if (!result.ok) return null;
    onUpdate(result.value);
    return result.value;
  }

  // Multi-jump: animate each step
  let current = state;
  let from = plan.from;

  for (let i = 0; i < plan.path.length; i++) {
    if (cancelledRef.current) return null;

    const destination = plan.path[i];
    const jumped = jumpPiece(current, from, destination);
    if (!jumped.ok) return null;

    current = jumped.value;
    from = destination;

    // Show intermediate state (pending jump, not yet confirmed)
    onUpdate(current);

    // Delay between jump steps (but not after the last step)
    if (i < plan.path.length - 1) {
      await sleep(AI_JUMP_STEP_MS);
    }
  }

  if (cancelledRef.current) return null;

  // Confirm the full jump
  const confirmed = confirmPendingJump(current);
  if (!confirmed.ok) return null;

  onUpdate(confirmed.value);
  return confirmed.value;
}
