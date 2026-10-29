import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playUiClick } from "@/lib/uiClickAudio";
import { SoundLabPage } from "./SoundLabPage";

vi.mock("@/lib/uiClickAudio", () => ({
  UI_CLICK_KEY: "tiao:uiClick",
  UI_CLICK_VOLUME_KEY: "tiao:uiClickVolume",
  playUiClick: vi.fn().mockResolvedValue(true),
  stopUiClicks: vi.fn(),
  getClickVolume: () => 0.65,
}));

describe("sound audition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  it("plays all 16 candidates in order, three taps each, then stops", async () => {
    render(<SoundLabPage />);
    fireEvent.click(screen.getByRole("button", { name: "Play montage" }));
    await act(async () => {
      vi.advanceTimersByTime(24000);
    });
    expect(playUiClick).toHaveBeenCalledTimes(48);
    expect(
      vi
        .mocked(playUiClick)
        .mock.calls.slice(0, 3)
        .map(([id]) => id),
    ).toEqual(["bamboo", "bamboo", "bamboo"]);
    expect(vi.mocked(playUiClick).mock.calls.at(-1)?.[0]).toBe("blip");
    expect(screen.getByRole("button", { name: "Play montage" })).toBeEnabled();
  });
  it("cancels scheduled taps on stop, mute and unmount", async () => {
    const { unmount } = render(<SoundLabPage />);
    fireEvent.click(screen.getByRole("button", { name: "Play montage" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop montage" }));
    await act(async () => {
      vi.advanceTimersByTime(24000);
    });
    expect(playUiClick).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Play montage" }));
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    await act(async () => {
      vi.advanceTimersByTime(24000);
    });
    expect(playUiClick).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Play montage" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    fireEvent.click(screen.getByRole("button", { name: "Play montage" }));
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(24000);
    });
    expect(playUiClick).toHaveBeenCalledTimes(3);
  });
  it("persists favourites and opt-in UI selection, and can turn selection off", () => {
    render(<SoundLabPage />);
    fireEvent.click(screen.getByRole("button", { name: "Favourite Walnut" }));
    expect(localStorage.getItem("tiao:uiClickFavourites")).toBe('["walnut"]');
    fireEvent.click(screen.getByRole("button", { name: "Use Walnut in game" }));
    expect(localStorage.getItem("tiao:uiClick")).toBe("walnut");
    fireEvent.click(screen.getByRole("button", { name: "Turn off UI sound" }));
    expect(localStorage.getItem("tiao:uiClick")).toBeNull();
  });
});
