import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID } from "@/components/game/boardThemes";
import { UnlockedBoardThemesContext } from "./UnlockedBoardThemesContext";
import { resetBoardTheme, useBoardThemeId, useSetBoardTheme } from "./useBoardTheme";

beforeEach(() => {
  localStorage.clear();
});

function withThemes(themes?: string[]) {
  return ({ children }: { children: ReactNode }) =>
    createElement(UnlockedBoardThemesContext.Provider, { value: themes }, children);
}

describe("useBoardThemeId", () => {
  it("returns the default theme when nothing is stored", () => {
    const { result } = renderHook(() => useBoardThemeId());
    expect(result.current).toBe(DEFAULT_THEME_ID);
  });

  it("returns the stored theme when the account owns it", () => {
    localStorage.setItem("tiao:boardTheme", "night");
    const { result } = renderHook(() => useBoardThemeId(), { wrapper: withThemes(["night"]) });
    expect(result.current).toBe("night");
  });

  it.each([
    { name: "guest", themes: undefined },
    { name: "account without purchases", themes: [] },
    { name: "account that owns another theme", themes: ["sakura"] },
  ])("uses Classic for a stale saved theme without access ($name)", ({ themes }) => {
    localStorage.setItem("tiao:boardTheme", "night");
    const { result } = renderHook(() => useBoardThemeId(), { wrapper: withThemes(themes) });
    expect(result.current).toBe(DEFAULT_THEME_ID);
  });

  it("uses Classic for an unknown saved theme", () => {
    localStorage.setItem("tiao:boardTheme", "unknown");
    const { result } = renderHook(() => useBoardThemeId(), {
      wrapper: withThemes(["unknown"]),
    });
    expect(result.current).toBe(DEFAULT_THEME_ID);
  });

  it("rechecks access when the account changes or ownership is revoked", () => {
    localStorage.setItem("tiao:boardTheme", "night");
    let themes: string[] | undefined = ["night"];
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(UnlockedBoardThemesContext.Provider, { value: themes }, children);
    const { result, rerender } = renderHook(() => useBoardThemeId(), { wrapper });
    expect(result.current).toBe("night");

    themes = [];
    rerender();
    expect(result.current).toBe(DEFAULT_THEME_ID);

    themes = undefined;
    rerender();
    expect(result.current).toBe(DEFAULT_THEME_ID);

    // Keep the preference so its owner can recover it after session verification.
    themes = ["night"];
    rerender();
    expect(result.current).toBe("night");
  });
});

describe("useSetBoardTheme", () => {
  it("persists the theme to localStorage", () => {
    const { result } = renderHook(() => useSetBoardTheme(), { wrapper: withThemes(["sakura"]) });
    act(() => {
      result.current[1]("sakura");
    });
    expect(result.current[0]).toBe("sakura");
    expect(localStorage.getItem("tiao:boardTheme")).toBe("sakura");
  });

  it.each([
    { name: "guest", themes: undefined },
    { name: "account without purchases", themes: [] },
    { name: "account that owns another theme", themes: ["night"] },
  ])("rejects an unowned selection ($name)", ({ themes }) => {
    const { result } = renderHook(() => useSetBoardTheme(), { wrapper: withThemes(themes) });
    act(() => result.current[1]("sakura"));
    expect(result.current[0]).toBe(DEFAULT_THEME_ID);
    expect(localStorage.getItem("tiao:boardTheme")).toBeNull();
  });

  it("rejects unknown themes even if present in the entitlement list", () => {
    const { result } = renderHook(() => useSetBoardTheme(), {
      wrapper: withThemes(["unknown"]),
    });
    act(() => result.current[1]("unknown"));
    expect(result.current[0]).toBe(DEFAULT_THEME_ID);
    expect(localStorage.getItem("tiao:boardTheme")).toBeNull();
  });

  it("always allows selecting Classic", () => {
    const { result } = renderHook(() => useSetBoardTheme());
    act(() => result.current[1](DEFAULT_THEME_ID));
    expect(result.current[0]).toBe(DEFAULT_THEME_ID);
    expect(localStorage.getItem("tiao:boardTheme")).toBe(DEFAULT_THEME_ID);
  });
});

describe("resetBoardTheme", () => {
  it("clears the stored theme and reverts to default", () => {
    localStorage.setItem("tiao:boardTheme", "night");
    const { result } = renderHook(() => useBoardThemeId(), { wrapper: withThemes(["night"]) });
    expect(result.current).toBe("night");

    act(() => {
      resetBoardTheme();
    });

    expect(result.current).toBe(DEFAULT_THEME_ID);
    expect(localStorage.getItem("tiao:boardTheme")).toBeNull();
  });
});
