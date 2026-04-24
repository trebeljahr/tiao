import { DEFAULT_THEME_ID } from "@/components/game/boardThemes";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetBoardTheme, useBoardThemeId, useSetBoardTheme } from "./useBoardTheme";

beforeEach(() => {
  localStorage.clear();
});

describe("useBoardThemeId", () => {
  it("returns the default theme when nothing is stored", () => {
    const { result } = renderHook(() => useBoardThemeId());
    expect(result.current).toBe(DEFAULT_THEME_ID);
  });

  it("returns the stored theme", () => {
    localStorage.setItem("tiao:boardTheme", "night");
    const { result } = renderHook(() => useBoardThemeId());
    expect(result.current).toBe("night");
  });
});

describe("useSetBoardTheme", () => {
  it("persists the theme to localStorage", () => {
    const { result } = renderHook(() => useSetBoardTheme());
    act(() => {
      result.current[1]("sakura");
    });
    expect(result.current[0]).toBe("sakura");
    expect(localStorage.getItem("tiao:boardTheme")).toBe("sakura");
  });
});

describe("resetBoardTheme", () => {
  it("clears the stored theme and reverts to default", () => {
    localStorage.setItem("tiao:boardTheme", "night");
    const { result } = renderHook(() => useBoardThemeId());
    expect(result.current).toBe("night");

    act(() => {
      resetBoardTheme();
    });

    expect(result.current).toBe(DEFAULT_THEME_ID);
    expect(localStorage.getItem("tiao:boardTheme")).toBeNull();
  });
});
