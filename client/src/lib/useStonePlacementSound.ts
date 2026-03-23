import { useEffect, useRef } from "react";
import type { GameState } from "@shared";

function countPieces(state: GameState) {
  return state.positions.reduce(
    (total, row) => total + row.filter((cell) => cell !== null).length,
    0
  );
}

function playStonePlacementSound(audioContext: AudioContext) {
  const now = audioContext.currentTime;
  const thump = audioContext.createOscillator();
  const body = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const lowpass = audioContext.createBiquadFilter();

  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(900, now);

  thump.type = "triangle";
  thump.frequency.setValueAtTime(520, now);
  thump.frequency.exponentialRampToValueAtTime(220, now + 0.08);

  body.type = "sine";
  body.frequency.setValueAtTime(180, now);
  body.frequency.exponentialRampToValueAtTime(90, now + 0.12);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

  thump.connect(lowpass);
  body.connect(lowpass);
  lowpass.connect(gain);
  gain.connect(audioContext.destination);

  thump.start(now);
  body.start(now);
  thump.stop(now + 0.18);
  body.stop(now + 0.18);
}

export function useStonePlacementSound(state: GameState | null) {
  const previousPieceCount = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!state) {
      previousPieceCount.current = null;
      return;
    }

    const nextPieceCount = countPieces(state);
    if (
      previousPieceCount.current !== null &&
      nextPieceCount > previousPieceCount.current &&
      typeof window !== "undefined"
    ) {
      const AudioContextConstructor =
        window.AudioContext ||
        (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;

      if (AudioContextConstructor) {
        const audioContext =
          audioContextRef.current || new AudioContextConstructor();
        audioContextRef.current = audioContext;

        if (audioContext.state === "suspended") {
          void audioContext.resume().catch(() => undefined);
        }

        playStonePlacementSound(audioContext);
      }
    }

    previousPieceCount.current = nextPieceCount;
  }, [state]);
}
