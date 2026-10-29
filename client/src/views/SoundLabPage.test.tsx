import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playUiClick } from "@/lib/uiClickAudio";
import { SoundLabPage } from "./SoundLabPage";

vi.mock("@/components/SoundPlayground", () => ({
  SoundPlayground: () => <div>Game playground</div>,
}));
vi.mock("@/lib/uiClickAudio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/uiClickAudio")>()),
  playUiClick: vi.fn().mockResolvedValue(true),
  playUiFeedback: vi.fn(),
  stopUiClicks: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("three-category sound lab", () => {
  it("saves a separate sound and volume for each category and restores them", () => {
    const { unmount } = render(<SoundLabPage />);
    fireEvent.click(screen.getByRole("radio", { name: "Select Felt" }));
    fireEvent.change(screen.getByLabelText("Click volume"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("tab", { name: /Success/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Select Settle" }));
    fireEvent.change(screen.getByLabelText("Success volume"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("tab", { name: /Error/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Select Soft pause" }));
    expect(localStorage.getItem("tiao:uiClick")).toBe("felt");
    expect(localStorage.getItem("tiao:uiSuccess")).toBe("settle");
    expect(localStorage.getItem("tiao:uiError")).toBe("soft-pause");
    unmount();
    render(<SoundLabPage />);
    expect(screen.getByRole("radio", { name: "Select Felt" })).toBeChecked();
    expect(screen.getByLabelText("Click volume")).toHaveValue("35");
    fireEvent.click(screen.getByRole("tab", { name: /Success/ }));
    expect(screen.getByRole("radio", { name: "Select Settle" })).toBeChecked();
    expect(screen.getByLabelText("Success volume")).toHaveValue("45");
    fireEvent.click(screen.getByRole("radio", { name: "Turn off success sound" }));
    expect(localStorage.getItem("tiao:uiSuccess")).toBeNull();
    expect(localStorage.getItem("tiao:uiError")).toBe("soft-pause");
  });
  it("plays the six click options once each, and cancels on mute or unmount", async () => {
    const { unmount } = render(<SoundLabPage />);
    fireEvent.click(screen.getByRole("button", { name: "Play click options" }));
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(playUiClick).toHaveBeenCalledTimes(6);
    expect(vi.mocked(playUiClick).mock.calls.map(([id]) => id)).toEqual([
      "felt",
      "velvet",
      "linen",
      "cork",
      "brush",
      "low-felt",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Play click options" }));
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(playUiClick).toHaveBeenCalledTimes(7);
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    fireEvent.click(screen.getByRole("button", { name: "Play click options" }));
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(playUiClick).toHaveBeenCalledTimes(8);
  });
});
