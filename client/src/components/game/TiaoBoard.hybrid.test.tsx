import { createInitialGameState } from "@shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TiaoBoard } from "./TiaoBoard";

vi.mock("@/lib/isTouchDevice", () => ({ IS_TOUCH_DEVICE: true }));

it("accepts keyboard/controller activation immediately after a prevented touch", () => {
  const state = createInitialGameState({ boardSize: 9 });
  state.positions[4][4] = "white";
  const click = vi.fn();
  render(<TiaoBoard state={state} selectedPiece={null} jumpTargets={[]} onPointClick={click} />);
  const board = screen.getByTestId("tiao-board");
  vi.spyOn(board, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 400,
  } as DOMRect);
  const touch = { clientX: 200, clientY: 200, identifier: 0 };
  fireEvent.touchStart(board, { touches: [touch] });
  fireEvent.touchEnd(board, { touches: [], changedTouches: [touch] });
  expect(click).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTestId("cell-4-4"), { detail: 0 });
  expect(click).toHaveBeenCalledTimes(2);
});
