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
  hold: number;
};

/** Expand the recorded game into placements, individual hops and confirmations. No AI runs in the browser. */
function buildFrames(): HeroFrame[] {
  let stones: HeroStone[] = [];
  let turn: HeroStone["color"] = "white";
  let score: [number, number] = [0, 0];
  let nextId = 0;
  const frames: HeroFrame[] = [{ stones, turn, score, hold: 350 }];
  for (const [index, move] of recording.moves.entries()) {
    if (move.type === "place" && move.position) {
      stones = [...stones, { id: nextId++, ...move.position, color: turn }];
    } else if (move.from && move.path) {
      let from: [number, number] = [move.from.x, move.from.y];
      const moving = stones.find((s) => s.x === from[0] && s.y === from[1])!;
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
        frames.push({ stones, turn, score, move: { from, to }, hold: 550 });
        from = to;
      }
      stones = stones.filter((s) => !s.captured);
      score = [...score];
      score[turn === "white" ? 0 : 1] += move.path.length;
    }
    turn = turn === "white" ? "black" : "white";
    frames.push({ stones, turn, score, hold: index < recording.openingPlies ? 400 : 700 });
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
