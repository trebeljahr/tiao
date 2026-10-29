import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playUiClick } from "@/lib/uiClickAudio";
import { UiClickFeedback } from "./UiClickFeedback";

vi.mock("@/lib/uiClickAudio", () => ({
  UI_CLICK_KEY: "tiao:uiClick",
  playUiClick: vi.fn().mockResolvedValue(true),
  stopUiClicks: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("UI click feedback", () => {
  function fixture() {
    render(
      <>
        <UiClickFeedback />
        <button type="button">
          <span>Menu</span>
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
  it("stays silent until a choice is saved, then handles nested click targets", async () => {
    fixture();
    fireEvent.click(screen.getByText("Menu"));
    await act(async () => {});
    expect(playUiClick).not.toHaveBeenCalled();
    localStorage.setItem("tiao:uiClick", "walnut");
    fireEvent.click(screen.getByText("Menu"));
    await act(async () => {});
    expect(playUiClick).toHaveBeenCalledExactlyOnceWith("walnut");
  });
  it("respects mute and skips disabled controls, auditions and board stones", async () => {
    localStorage.setItem("tiao:uiClick", "walnut");
    fixture();
    for (const label of ["Disabled", "Audition", "Stone"]) fireEvent.click(screen.getByText(label));
    await act(async () => {});
    expect(playUiClick).not.toHaveBeenCalled();
    cleanup();
    localStorage.setItem("tiao:soundEnabled", "0");
    fixture();
    fireEvent.click(screen.getByText("Menu"));
    await act(async () => {});
    expect(playUiClick).not.toHaveBeenCalled();
  });
});
