import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useActiveBadgeId,
  useActiveBadges,
  useSetActiveBadges,
  resetActiveBadges,
} from "./useActiveBadge";

beforeEach(() => {
  localStorage.clear();
});

describe("useActiveBadgeId", () => {
  it("returns null when nothing is stored", () => {
    const { result } = renderHook(() => useActiveBadgeId());
    expect(result.current).toBeNull();
  });

  it("returns the first badge from a stored JSON array", () => {
    localStorage.setItem("tiao:activeBadges", JSON.stringify(["creator", "supporter"]));
    const { result } = renderHook(() => useActiveBadgeId());
    expect(result.current).toBe("creator");
  });
});

describe("useActiveBadges", () => {
  it("returns an empty array when nothing is stored", () => {
    const { result } = renderHook(() => useActiveBadges());
    expect(result.current).toEqual([]);
  });

  it("parses a stored JSON array", () => {
    localStorage.setItem("tiao:activeBadges", JSON.stringify(["creator", "supporter"]));
    const { result } = renderHook(() => useActiveBadges());
    expect(result.current).toEqual(["creator", "supporter"]);
  });
});

describe("useSetActiveBadges", () => {
  it("persists badges to localStorage", () => {
    const { result } = renderHook(() => useSetActiveBadges());
    act(() => {
      result.current[1](["creator"]);
    });
    expect(result.current[0]).toEqual(["creator"]);
    expect(localStorage.getItem("tiao:activeBadges")).toBe(JSON.stringify(["creator"]));
  });

  it("removes the key when setting an empty array", () => {
    localStorage.setItem("tiao:activeBadges", JSON.stringify(["creator"]));
    const { result } = renderHook(() => useSetActiveBadges());
    act(() => {
      result.current[1]([]);
    });
    expect(result.current[0]).toEqual([]);
    expect(localStorage.getItem("tiao:activeBadges")).toBeNull();
  });
});

describe("resetActiveBadges", () => {
  it("clears stored badges and notifies subscribers", () => {
    localStorage.setItem("tiao:activeBadges", JSON.stringify(["creator", "supporter"]));
    const { result } = renderHook(() => useActiveBadges());
    expect(result.current).toEqual(["creator", "supporter"]);

    act(() => {
      resetActiveBadges();
    });

    expect(result.current).toEqual([]);
    expect(localStorage.getItem("tiao:activeBadges")).toBeNull();
  });
});
