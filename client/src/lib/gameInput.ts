export type InputAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "accept"
  | "cancel"
  | "confirm"
  | "previous"
  | "next"
  | "menu";

export const INPUT_EVENT = "tiao-input";

// Physical positions in the W3C standard mapping, also used by Steam Input's
// virtual Xbox controller. Unknown mappings must be remapped by the host.
export function readGamepad(pad: Gamepad): InputAction[] {
  if (!pad.connected || pad.mapping !== "standard") return [];
  const pressed = (index: number) => pad.buttons[index]?.pressed;
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  const actions: InputAction[] = [];
  if (pressed(12) || y < -0.55) actions.push("up");
  else if (pressed(13) || y > 0.55) actions.push("down");
  // One axis per frame prevents diagonal stick noise from moving twice.
  else if (pressed(14) || x < -0.55) actions.push("left");
  else if (pressed(15) || x > 0.55) actions.push("right");
  if (pressed(0)) actions.push("accept");
  if (pressed(1)) actions.push("cancel");
  if (pressed(2)) actions.push("confirm");
  if (pressed(4)) actions.push("previous");
  if (pressed(5)) actions.push("next");
  if (pressed(9)) actions.push("menu");
  return actions;
}

export const isDirection = (action: InputAction) =>
  action === "up" || action === "down" || action === "left" || action === "right";

/** Actions fire once per press; only cursor movement repeats. */
export class GamepadRepeater {
  private pads = new Map<number, { id: string; held: Map<InputAction, number> }>();

  reset() {
    this.pads.clear();
  }

  poll(pads: readonly (Gamepad | null)[], now: number): InputAction[] {
    const result: InputAction[] = [];
    const connected = new Set<number>();
    for (const pad of pads) {
      if (!pad?.connected) continue;
      connected.add(pad.index);
      const actions = readGamepad(pad);
      let previous = this.pads.get(pad.index);
      if (!previous || previous.id !== pad.id) {
        // Arm only after release, including after focus returns or reconnection.
        previous = { id: pad.id, held: new Map(actions.map((a) => [a, Infinity])) };
        this.pads.set(pad.index, previous);
      } else {
        for (const action of actions) {
          const repeatAt = previous.held.get(action);
          if (repeatAt === undefined) {
            result.push(action);
            previous.held.set(action, isDirection(action) ? now + 320 : Infinity);
          } else if (now >= repeatAt) {
            result.push(action);
            previous.held.set(action, now + 100);
          }
        }
      }
      for (const action of previous.held.keys()) {
        if (!actions.includes(action)) previous.held.delete(action);
      }
    }
    for (const index of this.pads.keys()) {
      if (!connected.has(index)) this.pads.delete(index);
    }
    // Shared-screen local play uses one cursor, even with several controllers.
    return [...new Set(result)];
  }
}
