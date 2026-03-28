import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
import type { PlayerColor } from "@shared";
import { useBoardTheme } from "./useBoardTheme";
import type { BoardTheme } from "@/components/game/boardThemes";

type WinConfettiOptions = {
  /** The player viewing the result. When null (local mode), confetti always plays. */
  viewerColor?: PlayerColor | null;
};

export function useWinConfetti(winner: PlayerColor | null, options: WinConfettiOptions = {}) {
  const { viewerColor = null } = options;
  const lastWinnerRef = useRef<PlayerColor | null>(null);
  const theme = useBoardTheme();

  useEffect(() => {
    if (!winner) {
      lastWinnerRef.current = null;
      return;
    }

    if (lastWinnerRef.current === winner) {
      return;
    }

    lastWinnerRef.current = winner;

    const isLoser = viewerColor !== null && winner !== viewerColor;

    if (isLoser) {
      playDefeatParticles(theme);
    } else {
      playVictoryConfetti(theme);
    }
  }, [winner, viewerColor, theme]);
}

function playVictoryConfetti(theme: BoardTheme) {
  confetti({
    particleCount: 120,
    startVelocity: 45,
    spread: 360,
    origin: { x: 0.5, y: 0.4 },
    colors: theme.victoryColors,
    scalar: 1.2,
    gravity: 0.6,
    ticks: 200,
    shapes: ["circle", "square"],
  });
}

function playDefeatParticles(theme: BoardTheme) {
  const duration = 1800;
  const endTime = Date.now() + duration;
  const colors = theme.defeatColors;

  const frame = () => {
    confetti({
      particleCount: 2,
      startVelocity: 8,
      spread: 160,
      gravity: 0.35,
      drift: 0.6 + Math.random() * 0.8,
      origin: { x: Math.random(), y: -0.05 },
      colors,
      scalar: 1.2,
      shapes: ["circle"],
      ticks: 300,
    });

    if (Date.now() < endTime) {
      window.requestAnimationFrame(frame);
    }
  };

  frame();
}
