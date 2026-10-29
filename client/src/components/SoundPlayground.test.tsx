import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playUiFeedback } from "@/lib/uiClickAudio";
import { SoundPlayground } from "./SoundPlayground";
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
describe("real game sound playground", () => {
  it("uses the real setup dialog and emits only success when starting a game", async () => {
    render(
      <>
        <UiClickFeedback />
        <SoundPlayground />
      </>,
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "New game" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    vi.mocked(playUiFeedback).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Start game" }));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(playUiFeedback).toHaveBeenCalledExactlyOnceWith("success");
  });
  it("routes form validation and an actual illegal border placement to error", async () => {
    render(
      <>
        <UiClickFeedback />
        <SoundPlayground />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Check ID" }));
    expect(playUiFeedback).toHaveBeenCalledExactlyOnceWith("error");
    expect(screen.getByText("Use six letters or numbers")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Game ID"), { target: { value: "ABC123" } });
    vi.mocked(playUiFeedback).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Check ID" }));
    expect(playUiFeedback).toHaveBeenCalledExactlyOnceWith("success");
    vi.mocked(playUiFeedback).mockClear();
    fireEvent.click(screen.getByTestId("cell-0-0"));
    await act(async () => {});
    expect(playUiFeedback).toHaveBeenCalledExactlyOnceWith("error");
  });
});
