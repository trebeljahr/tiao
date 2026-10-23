import recording from "./heroGameRecording.json";

export type HeroStone = {
  id: number;
  x: number;
  y: number;
  color: "white" | "black";
  captured?: boolean;
};
export type HeroFrame = {
  stones: HeroStone[];
  turn: "white" | "black";
  score: [number, number];
  move?: { from: [number, number]; to: [number, number] };
  trail?: { from: [number, number]; to: [number, number] }[];
  hold: number;
};

/** Expand the composed tactical example into placements, hops and confirmation. */
function buildFrames(): HeroFrame[] {
  let stones: HeroStone[] = recording.initial.stones.map((stone, id) => ({
    ...stone,
    id,
    color: stone.color as HeroStone["color"],
  }));
  let turn: HeroStone["color"] = recording.initial.turn as HeroStone["color"];
  let score = [...recording.initial.score] as [number, number];
  let nextId = stones.length;
  const frames: HeroFrame[] = [{ stones, turn, score, hold: 1400 }];
  for (const move of recording.moves) {
    if (move.type === "place" && move.position) {
      stones = [...stones, { id: nextId++, ...move.position, color: turn }];
    } else if (move.from && move.path) {
      let from: [number, number] = [move.from.x, move.from.y];
      const moving = stones.find((s) => s.x === from[0] && s.y === from[1])!;
      const trail: NonNullable<HeroFrame["trail"]> = [];
      for (const target of move.path) {
        const to: [number, number] = [target.x, target.y];
        const victim = stones.find(
          (s) => s.x === (from[0] + to[0]) / 2 && s.y === (from[1] + to[1]) / 2,
        )!;
        stones = stones.map((s) =>
          s.id === moving.id
            ? { ...s, x: to[0], y: to[1] }
            : s.id === victim.id
              ? { ...s, captured: true }
              : s,
        );
        trail.push({ from, to });
        frames.push({ stones, turn, score, move: { from, to }, trail: [...trail], hold: 700 });
        from = to;
      }
      stones = stones.filter((s) => !s.captured);
      score = [...score];
      score[turn === "white" ? 0 : 1] += move.path.length;
    }
    turn = turn === "white" ? "black" : "white";
    frames.push({ stones, turn, score, hold: move.hold });
  }
  frames.at(-1)!.hold = 4200;
  return frames;
}
export const HERO_FRAMES = buildFrames();

// The last settled position before the replay’s final capture chain.
const reversedFrames = [...HERO_FRAMES].reverse();
const finalJumpIndex = reversedFrames.findIndex((frame) => frame.move);
export const HERO_PRE_JUMP_FRAME = reversedFrames
  .slice(finalJumpIndex)
  .find((frame) => !frame.move)!;
