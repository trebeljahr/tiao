import { createInitialGameState, type GameState, placePiece } from "@shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRecoverableGameState, loadTabGame, useTabGameRecovery } from "./tabGameRecovery";

function navigationType(type: "reload" | "navigate") {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([
    { type } as unknown as PerformanceEntry,
  ]);
}

const played = (): GameState => {
  const result = placePiece(createInitialGameState({ boardSize: 9 }), { x: 4, y: 4 });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
};

describe("tab game recovery", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/local?autostart=1");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores the saved game after a reload of the same URL", () => {
    navigationType("navigate");
    const game = played();
    const first = renderHook(
      ({ snapshot }) => useTabGameRecovery("local", snapshot, isRecoverableGameState, vi.fn()),
      {
        initialProps: { snapshot: null as GameState | null },
      },
    );
    first.rerender({ snapshot: game });

    navigationType("reload");
    const onRestore = vi.fn();
    renderHook(() =>
      useTabGameRecovery("local", createInitialGameState(), isRecoverableGameState, onRestore),
    );
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore.mock.calls[0][0].history).toHaveLength(1);
  });

  it("does not overwrite the saved game with the fresh board before the restore renders", () => {
    navigationType("navigate");
    const game = played();
    const first = renderHook(
      ({ snapshot }) => useTabGameRecovery("local", snapshot, isRecoverableGameState, vi.fn()),
      {
        initialProps: { snapshot: game },
      },
    );
    first.rerender({ snapshot: { ...game } });
    navigationType("reload");
    renderHook(() =>
      useTabGameRecovery(
        "local",
        createInitialGameState({ boardSize: 9 }),
        isRecoverableGameState,
        vi.fn(),
      ),
    );
    expect(loadTabGame("local", isRecoverableGameState)?.history).toHaveLength(1);
  });

  it("a fresh navigation starts a new game and forgets the old record", () => {
    navigationType("navigate");
    renderHook(() => useTabGameRecovery("local", played(), isRecoverableGameState, vi.fn()));
    const onRestore = vi.fn();
    renderHook(() => useTabGameRecovery("local", null, isRecoverableGameState, onRestore));
    expect(onRestore).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("ignores records from another URL, corrupt records and invalid games", () => {
    navigationType("navigate");
    renderHook(() => useTabGameRecovery("local", played(), isRecoverableGameState, vi.fn()));
    window.history.replaceState(null, "", "/local?other=1");
    expect(loadTabGame("local", isRecoverableGameState)).toBeNull();
    window.sessionStorage.setItem("tiao:tab-game:v1:local", "{not json");
    expect(loadTabGame("local", isRecoverableGameState)).toBeNull();
    expect(isRecoverableGameState({ boardSize: 9, positions: [] })).toBe(false);
  });

  it("leaving the page inside the app removes the record", async () => {
    navigationType("navigate");
    const view = renderHook(() =>
      useTabGameRecovery("local", played(), isRecoverableGameState, vi.fn()),
    );
    view.unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(window.sessionStorage.getItem("tiao:tab-game:v1:local")).toBeNull();
  });
});
