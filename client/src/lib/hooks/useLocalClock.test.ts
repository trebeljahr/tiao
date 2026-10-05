import type { TurnRecord } from "@shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocalClock } from "./useLocalClock";

const tc = { initialMs: 60_000, incrementMs: 2_000 };
const move = (color: "white" | "black", timestamp: number) =>
  ({ type: "put", color, position: { x: 0, y: 0 }, timestamp }) as TurnRecord;

describe("useLocalClock restore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resumes a reloaded timed game from its move timestamps without an extra increment", () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    const history = [move("white", t0), move("black", t0 + 10_000), move("white", t0 + 15_000)];
    const view = renderHook(
      ({ control, turn, moves }) => useLocalClock(control, turn, false, moves),
      {
        initialProps: {
          control: null as typeof tc | null,
          turn: "white" as "white" | "black",
          moves: [] as TurnRecord[],
        },
      },
    );
    // Same update: game, time control and clock restore, as LocalGamePage does.
    act(() => {
      view.result.current.restoreClock(tc, history, "black");
      view.rerender({ control: tc, turn: "black", moves: history });
    });
    // white: 60s + 2s (first move) - 5s + 2s = 59s; black: 60s - 10s + 2s = 52s.
    expect(view.result.current.clock.white).toBe(59_000);
    expect(view.result.current.clock.black).toBe(52_000);
  });
});
