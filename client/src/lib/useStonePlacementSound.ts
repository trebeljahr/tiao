import type { GameState } from "@shared";
import { useEffect, useRef } from "react";
import { safeLocalStorage } from "./safeLocalStorage";
import { useSoundEnabled } from "./useSoundPreference";

function countPieces(state: GameState) {
  return state.positions.reduce(
    (total, row) => total + row.filter((cell) => cell !== null).length,
    0,
  );
}

let cachedAudio: HTMLAudioElement | null = null;

function playMoveSound() {
  if (!cachedAudio) {
    cachedAudio = new Audio("/move.mp3");
  }
  cachedAudio.currentTime = 0;
  cachedAudio.play().catch(() => undefined);
}

/** Play the move sound if the user has sound enabled. Usable outside React. */
export function playMoveSoundIfEnabled() {
  const stored = safeLocalStorage.getItem("tiao:soundEnabled");
  const enabled = stored === null ? true : stored === "1";
  if (enabled) playMoveSound();
}

export function useStonePlacementSound(state: GameState | null) {
  const previousPieceCount = useRef<number | null>(null);
  const previousJumpLength = useRef<number | null>(null);
  const soundEnabled = useSoundEnabled();

  useEffect(() => {
    if (!state) {
      previousPieceCount.current = null;
      previousJumpLength.current = null;
      return;
    }

    const nextPieceCount = countPieces(state);
    const nextJumpLength = state.pendingJump.length;

    const pieceAdded =
      previousPieceCount.current !== null && nextPieceCount > previousPieceCount.current;

    const jumpStepAdded =
      previousJumpLength.current !== null && nextJumpLength > previousJumpLength.current;

    // A jump was confirmed when pendingJump transitions from non-empty to empty.
    const jumpConfirmed =
      previousJumpLength.current !== null && previousJumpLength.current > 0 && nextJumpLength === 0;

    if ((pieceAdded || jumpStepAdded || jumpConfirmed) && soundEnabled) {
      playMoveSound();
    }

    previousPieceCount.current = nextPieceCount;
    previousJumpLength.current = nextJumpLength;
  }, [state, soundEnabled]);
}
