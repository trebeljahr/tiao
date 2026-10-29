import { describe, expect, it } from "vitest";
import { GamepadRepeater, readGamepad } from "./gameInput";

function gamepad(buttons: number[] = [], axes = [0, 0], index = 0): Gamepad {
  return {
    id: "Test controller",
    index,
    connected: true,
    mapping: "standard",
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: buttons.includes(i),
      touched: false,
      value: buttons.includes(i) ? 1 : 0,
    })),
    timestamp: 0,
    vibrationActuator: null,
  } as unknown as Gamepad;
}

describe("controller input", () => {
  it("maps standard buttons and ignores stick drift and unknown layouts", () => {
    expect(readGamepad(gamepad([], [0.2, -0.3]))).toEqual([]);
    expect(readGamepad(gamepad([0, 1, 2, 4, 5, 9, 12]))).toEqual([
      "up",
      "accept",
      "cancel",
      "confirm",
      "previous",
      "next",
      "menu",
    ]);
    expect(readGamepad(gamepad([], [0.8, 0]))).toEqual(["right"]);
    expect(readGamepad({ ...gamepad([0]), mapping: "" })).toEqual([]);
  });

  it("repeats only movement and arms after held buttons release", () => {
    const input = new GamepadRepeater();
    expect(input.poll([gamepad([0])], 0)).toEqual([]);
    expect(input.poll([gamepad([0])], 500)).toEqual([]);
    input.poll([gamepad()], 510);
    expect(input.poll([gamepad([0, 15])], 520)).toEqual(["right", "accept"]);
    expect(input.poll([gamepad([0, 15])], 839)).toEqual([]);
    expect(input.poll([gamepad([0, 15])], 840)).toEqual(["right"]);
    expect(input.poll([gamepad([0, 15])], 940)).toEqual(["right"]);
    input.poll([], 950);
    expect(input.poll([gamepad([0])], 960)).toEqual([]);
    input.poll([gamepad()], 970);
    expect(input.poll([gamepad([0])], 980)).toEqual(["accept"]);
    input.reset();
    expect(input.poll([gamepad([0])], 990)).toEqual([]);
  });

  it("handles sparse slots and deduplicates shared-screen controller input", () => {
    const input = new GamepadRepeater();
    input.poll([null, gamepad([], [0, 0], 1), gamepad([], [0, 0], 2)], 0);
    expect(input.poll([null, gamepad([0], [0, 0], 1), gamepad([0], [0, 0], 2)], 10)).toEqual([
      "accept",
    ]);
  });
});
