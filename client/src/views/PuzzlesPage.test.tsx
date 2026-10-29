import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUZZLE_PROGRESS_KEY } from "@/lib/puzzles/puzzleProgress";
import { PuzzlesPage } from "./PuzzlesPage";

vi.mock("@/components/game/PracticeLayout", () => ({
  PracticeLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/game/PuzzlePlayer", () => ({
  PuzzlePlayer: ({
    puzzle,
    onSolved,
    onNext,
  }: {
    puzzle: { id: string; title: string };
    onSolved: (id: string) => void;
    onNext: () => void;
  }) => (
    <section>
      <h1>{puzzle.title}</h1>
      <button type="button" onClick={() => onSolved(puzzle.id)}>
        Solve
      </button>
      <button type="button" onClick={onNext}>
        Skip
      </button>
    </section>
  ),
}));

beforeEach(() => localStorage.clear());
afterEach(cleanup);
describe("puzzle browsing", () => {
  it("resumes local progress and persists completion and skipping", async () => {
    localStorage.setItem(
      PUZZLE_PROGRESS_KEY,
      JSON.stringify({
        currentId: "puzzle-002",
        solved: ["puzzle-001"],
        seen: ["puzzle-001", "puzzle-002"],
      }),
    );
    render(<PuzzlesPage />);
    expect(await screen.findByRole("heading", { name: "Puzzle 002" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Solve" }));
    expect(screen.getByLabelText("Puzzle progress").textContent).toContain("Solved 2 / 200");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(PUZZLE_PROGRESS_KEY)!).currentId).toBe("puzzle-003"),
    );
  });
  it("filters by turn limit and allows direct selection", () => {
    render(<PuzzlesPage />);
    fireEvent.change(screen.getByLabelText("Turn limit"), { target: { value: "2" } });
    expect(screen.getByRole("heading", { name: "Puzzle 002" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Puzzle 001" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Choose a puzzle"), { target: { value: "puzzle-004" } });
    expect(screen.getByRole("heading", { name: "Puzzle 004" })).toBeTruthy();
  });
});
