import { useState, useEffect, useCallback, useRef } from "react";
import type { GameSettings, PlayerColor, Position } from "@shared";
import { isGameOver, undoLastTurn, jumpPiece, placePiece, confirmPendingJump } from "@shared";
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

export function useComputerGame(difficulty: AIDifficulty = 3, settings?: Partial<GameSettings>) {
  const local = useLocalGame(settings);
  const [computerColor, setComputerColor] = useState<PlayerColor>(randomComputerColor);
  const [computerThinking, setComputerThinking] = useState(false);
  const [thinkProgress, setThinkProgress] = useState(0);
  const [resetGeneration, setResetGeneration] = useState(0);

  // Track the game history length that triggered the current search.
  // This prevents re-triggering for the same position and handles strict mode:
  // cleanup doesn't need to reset computerThinking because the ref guards re-entry.
  const searchedForRef = useRef(-1);

  // Track the last resetGeneration the effect has observed.  When it
  // changes we must clear searchedForRef so the de-dup guard doesn't
  // prevent the AI from starting a search on the fresh board (e.g. when
  // histLen is 0 both before and after a reset).
  const lastResetGenRef = useRef(resetGeneration);

  // Ref to cancel the current AI operation (search + timeouts)
  const cancelRef = useRef<(() => void) | null>(null);

  // Stores the game state before the AI started its turn, so undo can
  // safely restore it even if the AI is mid-animation with pending jumps.
  const preAIStateRef = useRef<GameState | null>(null);

  // Keep a ref to the latest localGame so the effect can read it without
  // needing localGame itself as a dependency (which would re-trigger on
  // intermediate animation updates).
  const localGameRef = useRef(local.localGame);
  localGameRef.current = local.localGame;

  const needsMove = !isGameOver(local.localGame) && local.localGame.currentTurn === computerColor;

  // Stable trigger that doesn't change during multi-jump animation.
  // jumpPiece() only updates pendingJump/pendingCaptures — it doesn't
  // touch history or currentTurn. Using these as deps prevents the
  // effect from re-running (and its cleanup from cancelling the
  // in-progress animation) when animatePlan() updates localGame with
  // intermediate jump states.
  const histLen = local.localGame.history.length;
  const currentTurn = local.localGame.currentTurn;

  useEffect(() => {
    // Detect board resets: when resetGeneration changes, clear the
    // searchedForRef guard so the effect doesn't skip the new (identical-
    // histLen) position.  Without this, a reset that lands on histLen 0
    // while searchedForRef is already 0 (e.g. React StrictMode double-
    // invoke or two consecutive resets) would silently skip the AI turn.
    if (lastResetGenRef.current !== resetGeneration) {
      lastResetGenRef.current = resetGeneration;
      searchedForRef.current = -1;
    }

    if (!needsMove) {
      searchedForRef.current = -1;
      return;
    }

    // Don't re-trigger if we already started a search for this game state
    if (searchedForRef.current === histLen) return;
    searchedForRef.current = histLen;

    setComputerThinking(true);
    setThinkProgress(0);
    const cancelledRef = { current: false };
    const startTime = Date.now();
    const gameAtRequest = localGameRef.current;

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
        const finalState = await animatePlan(gameAtRequest, plan, cancelledRef, (state) => {
          if (!cancelledRef.current) {
            local.setLocalGame(state);
            local.setLocalSelection(null);
            local.setLocalError(null);
          }
        });

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
      // Clear the pre-AI snapshot so it doesn't go stale.
      // When the effect re-runs after a successful AI animation,
      // the cleanup fires (setting cancelledRef = true) before the
      // promise chain reaches its own preAIStateRef = null cleanup.
      // Without this, the stale snapshot persists into the next AI
      // turn and undo would jump back too far.
      preAIStateRef.current = null;
    };
  }, [needsMove, histLen, currentTurn, difficulty, computerColor, resetGeneration]);

  const handleBoardClick = useCallback(
    (position: Position) => {
      if (computerThinking || local.localGame.currentTurn === computerColor) {
        return;
      }
      local.handleLocalBoardClick(position);
    },
    [computerThinking, computerColor, local.localGame.currentTurn, local.handleLocalBoardClick],
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

    // Don't apply if we'd land on the computer's turn — that would
    // trigger an immediate AI move, which looks like a full restart.
    // This happens when undoing past the AI's first move with no
    // player move left to pair.
    if (state.currentTurn === computerColor) {
      return;
    }

    local.setLocalGame(state);
    local.setLocalSelection(null);
    local.setLocalError(null);
  }, [
    local.localGame,
    computerColor,
    local.setLocalGame,
    local.setLocalSelection,
    local.setLocalError,
  ]);

  const resetComputerGame = useCallback(
    (preferredComputerColor?: PlayerColor, settingsOverrides?: Partial<GameSettings>) => {
      if (cancelRef.current) {
        cancelRef.current();
        cancelRef.current = null;
      }
      preAIStateRef.current = null;
      searchedForRef.current = -1;
      setResetGeneration((g) => g + 1);
      setComputerColor(preferredComputerColor ?? randomComputerColor());
      local.resetLocalGame(settingsOverrides);
    },
    [local.resetLocalGame],
  );

  // Player can undo if they have at least one move in history
  const canUndo = local.localGame.history.some(
    (t) => (t.type === "put" || t.type === "jump") && t.color !== computerColor,
  );

  return {
    ...local,
    computerColor,
    computerThinking,
    thinkProgress,
    canUndo,
    handleLocalBoardClick: handleBoardClick,
    handleLocalUndoTurn: handleUndoForAI,
    resetLocalGame: resetComputerGame,
    controlsDisabled: computerThinking || local.localGame.currentTurn === computerColor,
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

  // Pause after the last hop so the user can see the completed jump
  // before captures are removed and the turn is confirmed.
  await sleep(AI_JUMP_STEP_MS);
  if (cancelledRef.current) return null;

  // Confirm the full jump
  const confirmed = confirmPendingJump(current);
  if (!confirmed.ok) return null;

  onUpdate(confirmed.value);
  return confirmed.value;
}
