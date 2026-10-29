import { createInitialGameState } from "@shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalGame } from "@/lib/hooks/useLocalGame";
import { TiaoBoard } from "./game/TiaoBoard";
import { InputNavigation } from "./InputNavigation";
import { Dialog } from "./ui/dialog";

vi.mock("@/lib/isTouchDevice", () => ({ IS_TOUCH_DEVICE: false }));

function LocalBoard() {
  const game = useLocalGame({ boardSize: 9, scoreToWin: 10 });
  return (
    <>
      <InputNavigation />
      <button type="button">Before board</button>
      <TiaoBoard
        state={game.localGame}
        selectedPiece={game.localSelection}
        jumpTargets={game.localJumpTargets}
        onPointClick={game.handleLocalBoardClick}
        onUndoLastJump={game.handleLocalUndoPendingJump}
        onConfirmJump={game.handleLocalConfirmPendingJump}
      />
      <button type="button">After board</button>
      <output data-testid="turn">{game.localGame.currentTurn}</output>
      <output data-testid="score">{game.localGame.score.white}</output>
    </>
  );
}

let frame: FrameRequestCallback;
let buttons: number[];
let focused: boolean;
let connected: boolean;
let now: number;
const cell = (x: number, y: number) => screen.getByTestId(`cell-${x}-${y}`);

function tick() {
  now += 20;
  act(() => frame(now));
}
function press(button: number) {
  buttons = [button];
  tick();
  buttons = [];
  tick();
}

beforeEach(() => {
  buttons = [];
  focused = true;
  connected = true;
  now = 0;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: () =>
      connected
        ? [
            {
              id: "Test controller",
              connected: true,
              index: 0,
              mapping: "standard",
              axes: [0, 0],
              buttons: Array.from({ length: 17 }, (_, i) => ({
                pressed: buttons.includes(i),
                value: buttons.includes(i) ? 1 : 0,
              })),
            },
          ]
        : [],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("keyboard board cursor", () => {
  it("recenters the cursor when game setup changes the board size", () => {
    const game = (size: number) => (
      <TiaoBoard
        state={createInitialGameState({ boardSize: size })}
        selectedPiece={null}
        jumpTargets={[]}
        onPointClick={() => {}}
      />
    );
    const { rerender } = render(game(19));
    rerender(game(9));
    expect(cell(4, 4)).toHaveAttribute("tabindex", "0");
    expect(cell(8, 8)).toHaveAttribute("tabindex", "-1");
  });
  it("uses one board Tab stop, moves/clamps with arrows and WASD, and leaves Tab free", () => {
    render(<LocalBoard />);
    expect(screen.getByTestId("tiao-board").querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    act(() => cell(4, 4).focus());
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(cell(5, 4)).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "w" });
    expect(cell(5, 3)).toHaveFocus();
    act(() => cell(0, 0).focus());
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(cell(0, 0)).toHaveFocus();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    expect(cell(0, 0).dispatchEvent(event)).toBe(true);
  });
});

describe("controller gameplay", () => {
  it("plays placements, a capture, undo and confirm through the real local game hook", () => {
    render(<LocalBoard />);
    tick(); // neutral arms the connected controller
    act(() => cell(4, 4).focus());
    press(0); // white
    press(15);
    press(0); // black (5,4)
    press(14);
    press(14);
    press(12);
    press(0); // white (3,3)
    press(14);
    press(12);
    press(0); // black (2,2)
    press(15);
    press(15);
    press(13);
    press(13);
    press(0); // select white (4,4)
    press(15);
    press(15);
    press(0); // jump (6,4)
    expect(cell(6, 4)).toHaveAttribute("data-piece", "white");
    expect(screen.getByTestId("turn")).toHaveTextContent("white");
    press(1); // undo pending jump
    expect(cell(4, 4)).toHaveAttribute("data-piece", "white");
    expect(cell(6, 4)).not.toHaveAttribute("data-piece");
    expect(cell(4, 4)).toHaveFocus();
    press(0); // select origin again after undo
    press(15);
    press(15);
    press(0); // repeat jump
    press(2); // confirm
    expect(screen.getByTestId("score")).toHaveTextContent("1");
    expect(screen.getByTestId("turn")).toHaveTextContent("black");
    expect(cell(5, 4)).not.toHaveAttribute("data-piece");
    press(5); // leave board with right bumper
    expect(screen.getByRole("button", { name: "After board" })).toHaveFocus();
  });

  it("does not play held actions after losing focus or reconnecting", () => {
    render(<LocalBoard />);
    tick();
    act(() => cell(4, 4).focus());
    focused = false;
    buttons = [0];
    tick();
    focused = true;
    tick();
    expect(cell(4, 4)).not.toHaveAttribute("data-piece");
    buttons = [];
    tick();
    press(0);
    expect(cell(4, 4)).toHaveAttribute("data-piece", "white");
    press(15);
    connected = false;
    tick();
    connected = true;
    buttons = [0];
    tick();
    expect(cell(5, 4)).not.toHaveAttribute("data-piece");
  });
});

describe("modal and form navigation", () => {
  it("traps keyboard/controller focus, dismisses only the top dialog and restores focus", () => {
    function Example() {
      const [open, setOpen] = useState(false);
      const [nested, setNested] = useState(false);
      return (
        <>
          <InputNavigation />
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <button type="button">Outside</button>
          <Dialog title="Outer" open={open} onOpenChange={setOpen}>
            <button type="button" onClick={() => setNested(true)}>
              Nested
            </button>
            <button type="button">Last</button>
          </Dialog>
          <Dialog title="Inner" open={nested} onOpenChange={setNested}>
            <button type="button">Inner action</button>
          </Dialog>
        </>
      );
    }
    render(<Example />);
    tick();
    act(() => screen.getByText("Open").focus());
    press(0);
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    act(() => screen.getByText("Last").focus());
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    act(() => screen.getByText("Nested").focus());
    press(0);
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    press(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByText("Nested")).toHaveFocus();
    press(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Open")).toHaveFocus();
  });

  it("edits controlled text fields and select values using the controller", () => {
    function Form() {
      const [value, setValue] = useState("");
      const [choice, setChoice] = useState("one");
      return (
        <>
          <InputNavigation />
          <input aria-label="Name" value={value} onChange={(e) => setValue(e.target.value)} />
          <select aria-label="Choice" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="one">One</option>
            <option value="two">Two</option>
          </select>
        </>
      );
    }
    render(<Form />);
    tick();
    act(() => screen.getByRole("textbox", { name: "Name" }).focus());
    press(0);
    expect(screen.getByRole("dialog", { name: "Text entry" })).toBeInTheDocument();
    for (const symbol of ['"', "'", "[", "]", "{", "}", "\\", "|", "^", "~", "`", "<", ">"]) {
      expect(screen.getByRole("button", { name: symbol })).toBeInTheDocument();
    }
    act(() => screen.getByRole("button", { name: "q" }).focus());
    press(0);
    act(() => screen.getByRole("button", { name: "Done" }).focus());
    press(0);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("q");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    act(() => screen.getByRole("combobox").focus());
    press(0);
    act(() => screen.getByRole("button", { name: "Two" }).focus());
    press(0);
    expect(screen.getByRole("combobox")).toHaveValue("two");
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("cleans up animation polling on unmount", () => {
    const { unmount } = render(<InputNavigation />);
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
