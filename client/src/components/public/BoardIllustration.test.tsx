import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BoardIllustration } from "./BoardIllustration";
import { HERO_PRE_JUMP_FRAME } from "./heroGame";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shows the pre-jump position without playback controls and stops when reduced motion changes", () => {
  vi.useFakeTimers();
  let onChange = () => {};
  const preference = {
    matches: true,
    addEventListener: vi.fn((_event: string, listener: () => void) => {
      onChange = listener;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", () => preference);
  const { container } = render(<BoardIllustration title="Example game" />);
  const position = () =>
    Array.from(container.querySelectorAll("g[style]"), (stone) => stone.getAttribute("style"));
  const still = position();
  expect(still).toHaveLength(HERO_PRE_JUMP_FRAME.stones.length);
  expect(screen.queryByRole("button")).toBeNull();
  act(() => vi.advanceTimersByTime(10000));
  expect(position()).toEqual(still);
  act(() => {
    preference.matches = false;
    onChange();
  });
  expect(position()).not.toEqual(still);
  act(() => vi.advanceTimersByTime(1000));
  act(() => {
    preference.matches = true;
    onChange();
  });
  expect(position()).toEqual(still);
  act(() => vi.advanceTimersByTime(10000));
  expect(position()).toEqual(still);
});
