import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
afterEach(cleanup);
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
