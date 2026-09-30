import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RulesBoard } from "./RulesBoard";

vi.mock("@/components/tutorial/InteractiveMiniBoard", () => ({
  InteractiveMiniBoard: ({
    onComplete,
    resetKey,
  }: {
    onComplete: () => void;
    resetKey: number;
  }) => (
    <button type="button" onClick={onComplete}>
      Play example {resetKey}
    </button>
  ),
}));

describe("RulesBoard", () => {
  it("keeps completion and reset independent for each rule", () => {
    render(
      <>
        <RulesBoard stepId="place" title="Placement">
          <p>Placement rule</p>
        </RulesBoard>
        <RulesBoard stepId="jump" title="Capture">
          <p>Capture rule</p>
        </RulesBoard>
      </>,
    );
    const placement = within(screen.getByRole("region", { name: "Placement" }));
    const capture = within(screen.getByRole("region", { name: "Capture" }));
    fireEvent.click(placement.getByRole("button", { name: "Play example 0" }));
    expect(placement.getByRole("status")).toHaveTextContent("Done. Reset the board");
    expect(capture.getByRole("status")).toHaveTextContent("Click the board");
    fireEvent.click(placement.getByRole("button", { name: "Reset board" }));
    expect(placement.getByRole("status")).toHaveTextContent("Click the board");
    expect(placement.getByRole("button", { name: "Play example 1" })).toBeInTheDocument();
    expect(capture.getByRole("button", { name: "Play example 0" })).toBeInTheDocument();
  });
});
