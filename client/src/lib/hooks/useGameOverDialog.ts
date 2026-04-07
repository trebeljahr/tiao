import { useState, useRef, useEffect } from "react";

/**
 * Manages a game-over dialog that opens with a short delay (for confetti/animation)
 * and resets when the game-over state clears.
 */
export function useGameOverDialog(gameOver: boolean) {
  const [open, setOpen] = useState(false);
  const prevRef = useRef(false);

  useEffect(() => {
    if (gameOver && !prevRef.current) {
      prevRef.current = true;
      const id = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(id);
    }
    if (!gameOver) {
      prevRef.current = false;
      setOpen(false);
    }
  }, [gameOver]);

  return { open, setOpen };
}
