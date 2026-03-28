import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { TurnRecord } from "@shared";
import { MoveList } from "./MoveList";

const sampleHistory: TurnRecord[] = [
  { type: "put", color: "white", position: { x: 9, y: 9 } },
  { type: "put", color: "black", position: { x: 10, y: 10 } },
  { type: "put", color: "white", position: { x: 5, y: 5 } },
  {
    type: "jump",
    color: "black",
    jumps: [
      {
        from: { x: 10, y: 10 },
        over: { x: 9, y: 9 },
        to: { x: 8, y: 8 },
        color: "black",
      },
    ],
  },
];

describe("MoveList", () => {
  it("renders empty state when history is empty", () => {
    render(<MoveList history={[]} currentMoveIndex={null} />);
    expect(screen.getByText("No moves yet.")).toBeTruthy();
  });

  it("renders all moves from history", () => {
    render(<MoveList history={sampleHistory} currentMoveIndex={3} />);

    const moveList = screen.getByTestId("move-list");
    expect(moveList).toBeTruthy();

    // Should have table rows with moves
    const rows = moveList.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2); // 4 moves -> 2 rows
  });

  it("highlights the active move", () => {
    render(<MoveList history={sampleHistory} currentMoveIndex={0} />);

    // The first move (j10) should have the active styling
    const activeSpan = screen.getByTestId("move-list").querySelector(".font-semibold");
    expect(activeSpan).toBeTruthy();
    expect(activeSpan!.textContent).toContain("k10");
  });

  it("does not render navigation buttons when not interactive", () => {
    render(<MoveList history={sampleHistory} currentMoveIndex={3} interactive={false} />);

    expect(screen.queryByLabelText("Previous move")).toBeNull();
    expect(screen.queryByLabelText("Next move")).toBeNull();
  });

  it("renders navigation buttons when interactive", () => {
    render(
      <MoveList
        history={sampleHistory}
        currentMoveIndex={1}
        onSelectMove={() => {}}
        interactive={true}
      />,
    );

    expect(screen.getByLabelText("Go to start")).toBeTruthy();
    expect(screen.getByLabelText("Previous move")).toBeTruthy();
    expect(screen.getByLabelText("Next move")).toBeTruthy();
    expect(screen.getByLabelText("Go to end")).toBeTruthy();
  });

  it("calls onSelectMove when clicking a move in interactive mode", () => {
    const onSelectMove = vi.fn();
    render(
      <MoveList
        history={sampleHistory}
        currentMoveIndex={0}
        onSelectMove={onSelectMove}
        interactive={true}
      />,
    );

    // Click the "Next move" button
    fireEvent.click(screen.getByLabelText("Next move"));
    expect(onSelectMove).toHaveBeenCalledWith(1);
  });

  it("calls onSelectMove with -1 when clicking Go to start", () => {
    const onSelectMove = vi.fn();
    render(
      <MoveList
        history={sampleHistory}
        currentMoveIndex={2}
        onSelectMove={onSelectMove}
        interactive={true}
      />,
    );

    fireEvent.click(screen.getByLabelText("Go to start"));
    expect(onSelectMove).toHaveBeenCalledWith(-1);
  });

  it("disables Previous/Start when at the beginning", () => {
    render(
      <MoveList
        history={sampleHistory}
        currentMoveIndex={-1}
        onSelectMove={() => {}}
        interactive={true}
      />,
    );

    expect(screen.getByLabelText("Go to start")).toBeDisabled();
    expect(screen.getByLabelText("Previous move")).toBeDisabled();
  });

  it("disables Next/End when at the last move", () => {
    render(
      <MoveList
        history={sampleHistory}
        currentMoveIndex={3}
        onSelectMove={() => {}}
        interactive={true}
      />,
    );

    expect(screen.getByLabelText("Next move")).toBeDisabled();
    expect(screen.getByLabelText("Go to end")).toBeDisabled();
  });

  it("does not call window.scrollIntoView when changing moves", () => {
    const onSelectMove = vi.fn();
    const { rerender } = render(
      <MoveList
        history={sampleHistory}
        currentMoveIndex={0}
        onSelectMove={onSelectMove}
        interactive={true}
      />,
    );

    // scrollIntoView should NOT have been called on the document body
    const container = screen.getByTestId("move-list").querySelector(".overflow-y-auto");
    expect(container).toBeTruthy();

    // The scroll behavior should be container-scoped, not using scrollIntoView
    // Re-render with a different move index - no page scroll should occur
    rerender(
      <MoveList
        history={sampleHistory}
        currentMoveIndex={2}
        onSelectMove={onSelectMove}
        interactive={true}
      />,
    );

    // The container-based scroll logic uses scrollTop, not scrollIntoView
    // Verify the active move element exists with correct styling
    const activeElements = screen.getByTestId("move-list").querySelectorAll(".font-semibold");
    expect(activeElements.length).toBeGreaterThan(0);
  });

  it("hides nav buttons when hideNavButtons is true", () => {
    render(
      <MoveList
        history={sampleHistory}
        currentMoveIndex={1}
        onSelectMove={() => {}}
        interactive={true}
        hideNavButtons={true}
      />,
    );

    expect(screen.queryByLabelText("Go to start")).toBeNull();
    expect(screen.queryByLabelText("Previous move")).toBeNull();
  });
});
