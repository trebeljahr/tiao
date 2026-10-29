import { type KeyboardEvent, type RefObject, useEffect, useState } from "react";
import { focusElement } from "@/lib/focusNavigation";
import { INPUT_EVENT, type InputAction, isDirection } from "@/lib/gameInput";

type Position = { x: number; y: number };
type Options = {
  ref: RefObject<HTMLDivElement | null>;
  size: number;
  disabled: boolean;
  onCancel: () => Position | undefined;
  onConfirm: () => void;
};

/** One Tab stop per board; arrows/WASD move in board coordinates. */
export function useBoardInput({ ref, size, disabled, onCancel, onConfirm }: Options) {
  const [cursor, setCursor] = useState<Position>(() => ({
    x: Math.floor(size / 2),
    y: Math.floor(size / 2),
  }));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    setCursor({ x: Math.floor(size / 2), y: Math.floor(size / 2) });
  }, [size]);
  const position = { x: Math.min(cursor.x, size - 1), y: Math.min(cursor.y, size - 1) };

  function focusPosition(next: Position) {
    focusElement(
      ref.current?.querySelector<HTMLElement>(
        `[data-board-x="${next.x}"][data-board-y="${next.y}"]`,
      ) ?? undefined,
    );
  }

  function cancel() {
    const origin = onCancel();
    if (origin) focusPosition(origin);
  }

  function move(action: InputAction) {
    const active = document.activeElement as HTMLElement | null;
    const x = Number(active?.dataset.boardX ?? position.x);
    const y = Number(active?.dataset.boardY ?? position.y);
    const next = {
      x: Math.max(0, Math.min(size - 1, x + (action === "right" ? 1 : action === "left" ? -1 : 0))),
      y: Math.max(0, Math.min(size - 1, y + (action === "down" ? 1 : action === "up" ? -1 : 0))),
    };
    focusPosition(next);
  }

  // Keep event handlers on the board, so dialogs and text fields own their input.
  useEffect(() => {
    const board = ref.current;
    if (!board) return;
    function handle(event: Event) {
      const action = (event as CustomEvent<InputAction>).detail;
      if (disabled || (!isDirection(action) && action !== "confirm" && action !== "cancel")) return;
      event.preventDefault();
      if (isDirection(action)) move(action);
      else if (action === "confirm") onConfirm();
      else cancel();
    }
    board.addEventListener(INPUT_EVENT, handle);
    return () => board.removeEventListener(INPUT_EVENT, handle);
  });

  function onKeyDown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || disabled) return;
    const key = event.key.toLowerCase();
    const direction: Record<string, InputAction> = {
      arrowup: "up",
      w: "up",
      arrowdown: "down",
      s: "down",
      arrowleft: "left",
      a: "left",
      arrowright: "right",
      d: "right",
    };
    if (direction[key]) {
      event.preventDefault();
      event.stopPropagation();
      move(direction[key]);
    } else if (key === "escape" || key === "backspace" || key === "x") {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) cancel();
    } else if (key === "c") {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) onConfirm();
    } else if ((key === "enter" || key === " ") && event.repeat) {
      event.preventDefault();
    }
  }

  return {
    focused,
    boardProps: {
      onKeyDown,
      onFocus: () => setFocused(true),
      onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false);
      },
    },
    cellProps: (pos: Position) => ({
      "data-board-x": pos.x,
      "data-board-y": pos.y,
      tabIndex: !disabled && pos.x === position.x && pos.y === position.y ? 0 : -1,
      onFocus: () => setCursor(pos),
    }),
  };
}
