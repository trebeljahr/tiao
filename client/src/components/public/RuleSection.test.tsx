import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StepBoardConfig } from "@/components/tutorial/ruleExamples";
import { RuleSection } from "./RuleSection";

vi.mock("@/components/tutorial/InteractiveMiniBoard", () => ({
  InteractiveMiniBoard: ({
    onComplete,
    resetKey,
    config,
  }: {
    onComplete: () => void;
    resetKey: number;
    config: StepBoardConfig;
  }) => (
    <button
      type="button"
      onClick={onComplete}
      data-mode={config.interaction.type}
      data-overlay={config.overlayHint}
    >
      Play example {resetKey}
    </button>
  ),
}));

describe("RuleSection", () => {
  it("shows repeat only for a completed example and resets it independently", () => {
    render(
      <>
        <RuleSection stepId="place" title="Placement">
          <p>Placement rule</p>
        </RuleSection>
        <RuleSection stepId="jump" title="Capture">
          <p>Capture rule</p>
        </RuleSection>
      </>,
    );
    const placement = within(screen.getByRole("region", { name: "Placement" }));
    const capture = within(screen.getByRole("region", { name: "Capture" }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Next example/ })).not.toBeInTheDocument();
    expect(placement.getByRole("button", { name: "Play example 0" })).toHaveAttribute(
      "data-mode",
      "free-place",
    );
    expect(capture.getByRole("button", { name: "Play example 0" })).toHaveAttribute(
      "data-mode",
      "guided-jump",
    );
    expect(placement.getByRole("button", { name: "Play example 0" })).not.toHaveAttribute(
      "data-overlay",
    );
    expect(capture.getByRole("button", { name: "Play example 0" })).not.toHaveAttribute(
      "data-overlay",
    );
    expect(screen.queryByRole("button", { name: "Reset board" })).not.toBeInTheDocument();
    fireEvent.click(placement.getByRole("button", { name: "Play example 0" }));
    expect(placement.getByRole("button", { name: "Reset board" })).toBeInTheDocument();
    expect(capture.queryByRole("button", { name: "Reset board" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(placement.getByRole("button", { name: "Reset board" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset board" })).not.toBeInTheDocument();
    expect(placement.getByRole("button", { name: "Play example 1" })).toBeInTheDocument();
    expect(capture.getByRole("button", { name: "Play example 0" })).toBeInTheDocument();
  });
});
