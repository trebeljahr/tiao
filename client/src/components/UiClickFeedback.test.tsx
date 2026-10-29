import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playUiFeedback } from "@/lib/uiClickAudio";
import { UiClickFeedback } from "./UiClickFeedback";

vi.mock("@/lib/uiClickAudio", () => ({
  playUiFeedback: vi.fn().mockResolvedValue(true),
  stopUiClicks: vi.fn(),
}));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("semantic UI feedback", () => {
  function fixture() {
    render(
      <>
        <UiClickFeedback />
        <button type="button">
          <span>Menu</span>
        </button>
        <button type="button" data-ui-feedback="success">
          Confirm
        </button>
        <button type="button" data-ui-feedback="error">
          Reject
        </button>
        <button type="button" data-ui-feedback="manual">
          Manual
        </button>
        <button type="button" disabled>
          Disabled
        </button>
        <div data-ui-sound="off">
          <button type="button">Audition</button>
        </div>
        <div data-testid="tiao-board">
          <button type="button">Stone</button>
        </div>
      </>,
    );
  }
  it("routes nested controls and success/error actions to one matching category each", async () => {
    fixture();
    for (const label of ["Menu", "Confirm", "Reject"]) fireEvent.click(screen.getByText(label));
    await act(async () => {});
    expect(vi.mocked(playUiFeedback).mock.calls.map(([kind]) => kind)).toEqual([
      "click",
      "success",
      "error",
    ]);
  });
  it("skips manual, disabled, audition and stone controls, and respects mute", async () => {
    fixture();
    for (const label of ["Manual", "Disabled", "Audition", "Stone"])
      fireEvent.click(screen.getByText(label));
    await act(async () => {});
    expect(playUiFeedback).not.toHaveBeenCalled();
    cleanup();
    localStorage.setItem("tiao:soundEnabled", "0");
    fixture();
    fireEvent.click(screen.getByText("Menu"));
    await act(async () => {});
    expect(playUiFeedback).not.toHaveBeenCalled();
  });
});

describe("outcome feedback", () => {
  it("plays new success/error toasts once, ignores history and stays silent while muted", async () => {
    vi.useFakeTimers();
    toast.success("Existing message", { id: "existing" });
    const { rerender } = render(<UiClickFeedback />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(playUiFeedback).not.toHaveBeenCalled();
    await act(async () => {
      toast.success("Copied", { id: "copied" });
      await vi.runOnlyPendingTimersAsync();
    });
    expect(playUiFeedback).toHaveBeenCalledExactlyOnceWith("success");
    rerender(<UiClickFeedback />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(playUiFeedback).toHaveBeenCalledTimes(1);
    await act(async () => {
      toast.error("Could not save", { id: "save-error" });
      await vi.runOnlyPendingTimersAsync();
    });
    expect(playUiFeedback).toHaveBeenLastCalledWith("error");
    expect(playUiFeedback).toHaveBeenCalledTimes(2);
    cleanup();
    localStorage.setItem("tiao:soundEnabled", "0");
    render(<UiClickFeedback />);
    await act(async () => {
      toast.success("Muted result", { id: "muted-result" });
      await vi.runOnlyPendingTimersAsync();
    });
    expect(playUiFeedback).toHaveBeenCalledTimes(2);
    toast.dismiss();
  });
});
