import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { InteractiveMiniBoard } from "./InteractiveMiniBoard";
import type { Cell, Pos } from "./tutorialEngine";
import type { StepBoardConfig } from "./tutorialSteps";

// Mock canvas-confetti
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// Mock framer-motion — render children as plain divs
vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target, prop) => {
        // Return a component that just renders as the HTML element
        return ({ children, ...rest }: any) => {
          const Tag = prop as string;
          // Filter out framer-motion-specific props
          const htmlProps: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              !k.startsWith("animate") &&
              !k.startsWith("initial") &&
              !k.startsWith("exit") &&
              !k.startsWith("transition") &&
              !k.startsWith("variants") &&
              !k.startsWith("whileHover") &&
              !k.startsWith("whileTap") &&
              k !== "layout" &&
              k !== "layoutId"
            ) {
              htmlProps[k] = v;
            }
          }
          return <Tag {...(htmlProps as any)}>{children}</Tag>;
        };
      },
    },
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock useBoardTheme
vi.mock("@/lib/useBoardTheme", () => ({
  useBoardTheme: () => ({
    boardBg: "#f0e0c0",
    boardBorder: "#c0a070",
    grooveStart: "#aaa",
    grooveEnd: "#888",
    gridLine: "#aaa",
    whiteFill: "#fff",
    whiteStroke: "#ccc",
    blackFill: "#333",
    blackStroke: "#222",
    victoryColors: ["#fff", "#000"],
  }),
}));

// Mock useStonePlacementSound
vi.mock("@/lib/useStonePlacementSound", () => ({
  playMoveSoundIfEnabled: vi.fn(),
}));

function board(size: number, pieces: Array<[number, number, Cell]>): Cell[][] {
  const b: Cell[][] = Array.from({ length: size }, () => Array(size).fill(null) as Cell[]);
  for (const [x, y, cell] of pieces) {
    b[y][x] = cell;
  }
  return b;
}

// The chain-jump tutorial board: 7x7, white at (3,5), black at (3,4) and (3,2)
// White can jump (3,5)->(3,3) over black at (3,4), then (3,3)->(3,1) over black at (3,2)
const chainJumpConfig: StepBoardConfig = {
  size: 7,
  initialBoard: board(7, [
    [3, 5, "W"],
    [3, 4, "B"],
    [3, 2, "B"],
  ]),
  interaction: {
    type: "chain-jump",
    firstSelect: { x: 3, y: 5 },
  },
};

function renderBoard(config: StepBoardConfig, onComplete = vi.fn()) {
  const t = (key: string) => key;
  return {
    onComplete,
    ...render(
      <InteractiveMiniBoard
        config={config}
        onComplete={onComplete}
        active={true}
        resetKey={0}
        t={t}
      />,
    ),
  };
}

function clickPos(pos: Pos, size: number) {
  // Find the button at the position. The component creates buttons with keys like "x-y"
  // and places them using absolute positioning. We query all buttons and find by data or position.
  const buttons = screen.getAllByRole("button");

  // Each button is placed at a percentage position based on grid math.
  // We need a more reliable way to find the button. The component uses
  // key={`${pos.x}-${pos.y}`} for each button.
  // Let's find buttons by their click handler behavior — we click all
  // in the grid. Actually, let's find by index: buttons are laid out
  // row by row for y=0..size-1, x=0..size-1.
  const idx = pos.y * size + pos.x;
  if (idx < buttons.length) {
    fireEvent.click(buttons[idx]);
  }
}

describe("InteractiveMiniBoard – chain-jump requires full chain", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("does NOT complete when confirming after only one jump", () => {
    const { onComplete } = renderBoard(chainJumpConfig);

    // 1. Select the white piece at (3,5)
    clickPos({ x: 3, y: 5 }, 7);

    // 2. Jump to (3,3) — over black at (3,4). This is the first jump.
    clickPos({ x: 3, y: 3 }, 7);

    // 3. Try to confirm by clicking the piece at its current position (3,3)
    //    This should NOT complete because it's only 1 jump (chain-jump requires 2+)
    clickPos({ x: 3, y: 3 }, 7);

    // Advance timers in case onComplete would be called after a delay
    act(() => vi.advanceTimersByTime(2000));

    expect(onComplete).not.toHaveBeenCalled();
  });

  it("completes when confirming after the full chain (2 jumps)", () => {
    const { onComplete } = renderBoard(chainJumpConfig);

    // 1. Select the white piece at (3,5)
    clickPos({ x: 3, y: 5 }, 7);

    // 2. First jump: (3,5) -> (3,3) over black at (3,4)
    clickPos({ x: 3, y: 3 }, 7);

    // 3. Second jump: (3,3) -> (3,1) over black at (3,2)
    clickPos({ x: 3, y: 1 }, 7);

    // 4. Confirm by clicking the piece at (3,1)
    clickPos({ x: 3, y: 1 }, 7);

    // Advance timers — onComplete is called after 800ms delay
    act(() => vi.advanceTimersByTime(1000));

    expect(onComplete).toHaveBeenCalled();
  });
});
