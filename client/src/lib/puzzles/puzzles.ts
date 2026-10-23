import { createInitialGameState, type GameState, type PlayerColor } from "@shared";
import type { PuzzleMove } from "./puzzleRules";

export type Puzzle = {
  id: string;
  title: string;
  difficulty: "Study" | "Tactic" | "Challenge";
  player: PlayerColor;
  turns: number;
  score: { white: number; black: number };
  /** Composed 9×9 positions. W/B are absolute colours, not player/opponent. */
  rows: string[];
  hints: string[];
  explanation: string;
  /** One illustrative line. Other winning continuations are also accepted. */
  line: PuzzleMove[];
};

const p = (x: number, y: number) => ({ x, y });
const jump = (...points: [number, number][]): PuzzleMove => ({
  type: "jump",
  from: p(...points[0]),
  path: points.slice(1).map(([x, y]) => p(x, y)),
});
const place = (x: number, y: number): PuzzleMove => ({ type: "place", position: p(x, y) });

/**
 * Development studies, verified against the shared rules by puzzles.test.ts.
 * Each has exactly one winning first turn within its stated deadline.
 * A chain plus its confirmation counts as one turn. Placements are optional
 * even when a capture exists. Scores are already earned before the position.
 */
export const PUZZLES: Puzzle[] = [
  {
    id: "long-way-round",
    title: "The long way round",
    difficulty: "Study",
    player: "white",
    turns: 1,
    score: { white: 5, black: 8 },
    rows: [
      ".........",
      "...B.....",
      ".....B...",
      "..W..B...",
      "..BB.....",
      ".........",
      ".........",
      ".........",
      ".........",
    ],
    hints: [
      "Count five captures before you confirm. The first jump has two choices.",
      "Start at C4. The route through C6 keeps more stones available.",
      "At E4, turn through G4. The diagonal shortcut ends the chain too soon.",
    ],
    explanation:
      "C4 → C6 → E4 → G4 → E2 → C2 captures all five stones. Starting through E6 strands the chain. From E4, jumping straight to G2 also stops short. Plan the whole route before choosing the branch. Captured stones stay occupied until confirmation and cannot be captured twice.",
    line: [jump([2, 3], [2, 5], [4, 3], [6, 3], [4, 1], [2, 1])],
  },
  {
    id: "two-threats",
    title: "One stone, two threats",
    difficulty: "Tactic",
    player: "black",
    turns: 2,
    score: { white: 8, black: 8 },
    rows: [
      ".........",
      "....W....",
      ".........",
      ".....W...",
      ".........",
      ".....W...",
      ".........",
      "......W..",
      ".........",
    ],
    hints: [
      "A placement can threaten two separate winning chains.",
      "Look between the stones at F4 and F6.",
      "Place F5. White can block the upper route or the lower route, but cannot block both.",
    ],
    explanation:
      "Place F5. Black threatens F5 → F3 → D1 and F5 → F7 → H9. White has one turn and cannot stop both. In the example, White places D1, so Black takes the lower route. D1 is a legal edge placement because Black could reach it through a chain over White's stones.",
    line: [place(5, 4), place(3, 0), jump([5, 4], [5, 6], [7, 8])],
  },
  {
    id: "clear-the-ladder",
    title: "Clear the ladder",
    difficulty: "Tactic",
    player: "white",
    turns: 2,
    score: { white: 7, black: 9 },
    rows: [
      ".........",
      ".........",
      ".B....B..",
      ".W.......",
      ".B....B..",
      "......W..",
      ".........",
      ".........",
      ".........",
    ],
    hints: [
      "Black needs only one capture. Check what happens after each possible confirmation.",
      "The stone at G6 must capture both stones above it in the same turn.",
      "Play G6 → G4 → G2. Then B4 has two winning captures, and Black can block only one.",
    ],
    explanation:
      "G6 → G4 → G2 brings White to nine. Stopping at G4 lets Black play G3 → G5 and win. After the full chain, B4 threatens B2 and B6. Black cannot capture B4 because each landing is occupied, and one placement cannot block both White landings. After Black places B2, B4 → B6 wins.",
    line: [jump([6, 5], [6, 3], [6, 1]), place(1, 1), jump([1, 3], [1, 5])],
  },
  {
    id: "leave-the-last-jump",
    title: "Leave the last jump",
    difficulty: "Challenge",
    player: "black",
    turns: 2,
    score: { white: 8, black: 7 },
    rows: [
      ".........",
      ".........",
      ".B.W.....",
      ".........",
      "..WB.....",
      "..B.W....",
      "...W.....",
      "...B.W...",
      ".........",
    ],
    hints: [
      "You may confirm a chain while another jump is still available.",
      "C6 can remove the threat at C5. Consider the cost of continuing through E2.",
      "Play C6 → C4 and confirm. Continuing vacates C4, opening a winning chain for White.",
    ],
    explanation:
      "Play C6 → C4 and stop. Black keeps two routes for the remaining two captures. If Black continues C4 → E2, White can play E6 → C4 → A2, capturing D5 and B3 to reach ten. Stopping on C4 blocks White's first landing. In the example, White takes D8, and Black wins with D5 → F7 → F9.",
    line: [jump([2, 5], [2, 3]), jump([3, 6], [3, 8]), jump([3, 4], [5, 6], [5, 8])],
  },
  {
    id: "use-the-edge",
    title: "Use the edge",
    difficulty: "Challenge",
    player: "white",
    turns: 2,
    score: { white: 8, black: 8 },
    rows: [
      ".........",
      "......B..",
      ".......W.",
      ".......B.",
      ".......B.",
      ".....B...",
      ".........",
      ".........",
      ".........",
    ],
    hints: [
      "An edge placement is legal when an enemy chain can reach that intersection.",
      "Black at G2 can reach I4 over H3. That makes I4 available to White.",
      "Place I4. It creates two chains, through G4 and through G6.",
    ],
    explanation:
      "Place I4. The border rule allows it because Black at G2 can reach I4 over H3. White threatens I4 → G4 → I6 and I4 → G6 → E6. Black cannot block both routes in one turn. If Black captures H3 with H4 → H2, the lower chain still wins.",
    line: [place(8, 3), jump([7, 3], [7, 1]), jump([8, 3], [6, 5], [4, 5])],
  },
  {
    id: "offer-either-stone",
    title: "Offer either stone",
    difficulty: "Challenge",
    player: "black",
    turns: 2,
    score: { white: 8, black: 8 },
    rows: [
      ".........",
      ".........",
      ".........",
      "..WW.....",
      ".........",
      "...WB....",
      "....W....",
      ".........",
      ".........",
    ],
    hints: [
      "A capture can move the opponent's stone into your next chain.",
      "Place D7. White at D6 can capture either Black stone, but each capture has a reply.",
      "After D6 → F6, play D7 → F7 → F5. After D6 → D8, play E6 → E8 → C8.",
    ],
    explanation:
      "Place D7. If White takes E6 with D6 → F6, Black wins D7 → F7 → F5. If White takes D7 with D6 → D8, Black wins E6 → E8 → C8. Declining the sacrifice also leaves a winning chain. The captured stone's removal opens one route while White's new position supplies the second capture.",
    line: [place(3, 6), jump([3, 5], [5, 5]), jump([3, 6], [5, 6], [5, 4])],
  },
];

export function createPuzzleState(puzzle: Puzzle): GameState {
  const state = createInitialGameState({ boardSize: 9, scoreToWin: 10 });
  state.positions = puzzle.rows.map((row) =>
    [...row].map((cell) => (cell === "W" ? "white" : cell === "B" ? "black" : null)),
  );
  state.currentTurn = puzzle.player;
  state.score = { ...puzzle.score };
  return state;
}
