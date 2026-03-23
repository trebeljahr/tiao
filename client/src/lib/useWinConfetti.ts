import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
import type { PlayerColor } from "@shared";

export function useWinConfetti(winner: PlayerColor | null) {
  const lastWinnerRef = useRef<PlayerColor | null>(null);

  useEffect(() => {
    if (!winner) {
      lastWinnerRef.current = null;
      return;
    }

    if (lastWinnerRef.current === winner) {
      return;
    }

    lastWinnerRef.current = winner;

    const duration = 1400;
    const endTime = Date.now() + duration;
    const colors =
      winner === "black"
        ? ["#1a1410", "#5f554d", "#e0c28a", "#f7ecda"]
        : ["#f7f3ea", "#d7cab8", "#e0c28a", "#7f6445"];

    const frame = () => {
      confetti({
        particleCount: 5,
        startVelocity: 20,
        spread: 70,
        origin: { x: 0.15 + Math.random() * 0.7, y: 0.18 + Math.random() * 0.08 },
        colors,
        scalar: 0.95,
      });

      if (Date.now() < endTime) {
        window.requestAnimationFrame(frame);
      }
    };

    frame();
  }, [winner]);
}
