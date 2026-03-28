import { describe, it, expect } from "vitest";
import { createInitialGameState } from "@shared";
import {
  applyComputerTurnPlan,
  type ComputerTurnPlan,
} from "./computer-ai";

describe("applyComputerTurnPlan", () => {
  it("applies a placement plan", () => {
    const state = createInitialGameState();
    state.currentTurn = "black";

    const plan: ComputerTurnPlan = {
      type: "place",
      position: { x: 9, y: 9 },
      score: 100,
    };

    const result = applyComputerTurnPlan(state, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.positions[9][9]).toBe("black");
    expect(result.value.currentTurn).toBe("white");
  });

  it("applies a jump plan", () => {
    const state = createInitialGameState();
    state.positions[9][9] = "black";
    state.positions[9][10] = "white";
    state.currentTurn = "black";

    const plan: ComputerTurnPlan = {
      type: "jump",
      from: { x: 9, y: 9 },
      path: [{ x: 11, y: 9 }],
      score: 200,
    };

    const result = applyComputerTurnPlan(state, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.score.black).toBe(1);
    expect(result.value.currentTurn).toBe("white");
    expect(result.value.positions[9][10]).toBeNull();
  });

  it("applies a multi-hop jump plan", () => {
    const state = createInitialGameState();
    state.positions[9][6] = "black";
    state.positions[9][7] = "white";
    state.positions[9][9] = "white";
    state.currentTurn = "black";

    const plan: ComputerTurnPlan = {
      type: "jump",
      from: { x: 6, y: 9 },
      path: [
        { x: 8, y: 9 },
        { x: 10, y: 9 },
      ],
      score: 300,
    };

    const result = applyComputerTurnPlan(state, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.score.black).toBe(2);
    expect(result.value.positions[9][7]).toBeNull();
    expect(result.value.positions[9][9]).toBeNull();
    expect(result.value.positions[9][10]).toBe("black");
  });

  it("rejects invalid placement", () => {
    const state = createInitialGameState();
    state.positions[9][9] = "white";
    state.currentTurn = "black";

    const plan: ComputerTurnPlan = {
      type: "place",
      position: { x: 9, y: 9 },
      score: 100,
    };

    const result = applyComputerTurnPlan(state, plan);
    expect(result.ok).toBe(false);
  });
});
