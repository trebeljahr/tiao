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

/** Alternating legal placements, a white double capture, then Black's reply. */
function buildFrames(): HeroFrame[] {
  const frames: HeroFrame[] = [];
  let stones: HeroStone[] = [];
  const placements = [
    [7, 11],
    [8, 10],
    [6, 8],
    [10, 8],
    [7, 7],
    [5, 9],
    [12, 10],
    [12, 6],
  ];
  frames.push({ stones: [], turn: "white", score: [0, 0], hold: 1000 });
  placements.forEach(([x, y], id) => {
    const color = id % 2 === 0 ? "white" : "black";
    stones = [...stones, { id, x, y, color }];
    frames.push({ stones, turn: color === "white" ? "black" : "white", score: [0, 0], hold: 1400 });
  });
  function jump(
    id: number,
    victim: number,
    to: [number, number],
    turn: HeroFrame["turn"],
    score: [number, number],
  ) {
    const origin = stones.find((stone) => stone.id === id)!;
    stones = stones.map((stone) =>
      stone.id === id
        ? { ...stone, x: to[0], y: to[1] }
        : stone.id === victim
          ? { ...stone, captured: true }
          : stone,
    );
    frames.push({ stones, turn, score, move: { from: [origin.x, origin.y], to }, hold: 1600 });
  }
  jump(0, 1, [9, 9], "white", [0, 0]);
  jump(0, 3, [11, 7], "white", [0, 0]);
  stones = stones.filter((stone) => !stone.captured);
  frames.push({ stones, turn: "black", score: [2, 0], hold: 1800 });
  jump(7, 0, [10, 8], "black", [2, 0]);
  stones = stones.filter((stone) => !stone.captured);
  frames.push({ stones, turn: "white", score: [2, 1], hold: 4500 });
  return frames;
}
export const HERO_FRAMES = buildFrames();
