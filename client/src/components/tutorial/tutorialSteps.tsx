import React from "react";
import type { Cell, Pos } from "./tutorialEngine";

// --- Interaction mode types ---

export type InteractionMode =
  | { type: "free-place"; completionZone?: "border"; requiredPos?: Pos }
  | { type: "guided-jump"; selectPiece: Pos; jumpTo: Pos }
  | { type: "confirm-undo"; selectPiece: Pos; jumpTo: Pos }
  | { type: "chain-undo"; firstSelect: Pos; undoAfterJumps: number }
  | { type: "chain-jump"; firstSelect: Pos }
  | { type: "chain-jump-early"; firstSelect: Pos }
  | {
      type: "try-and-fail";
      illegal: Pos;
      errorMessage: string;
      then: Pos;
    }
  | {
      type: "try-and-fail-border";
      illegal: Pos;
      errorMessage: string;
      then: Pos;
    };

export type HintArrow = { from: Pos; to: Pos };

export type StepBoardConfig = {
  size: number;
  initialBoard: Cell[][];
  interaction: InteractionMode;
  turnColor?: "W" | "B";
  thickBorder?: boolean;
  /** Suggested position for free-place steps — shows a nudge ring */
  suggestedPos?: Pos;
  /** Faint static arrows showing possible jump paths (e.g. enemy threat on border) */
  hintArrows?: HintArrow[];
};

export type TutorialStep = {
  id: string;
  title: string;
  description: React.ReactNode;
  board?: StepBoardConfig;
};

// --- Helper ---

function board(size: number, pieces: Array<[number, number, Cell]>): Cell[][] {
  const b: Cell[][] = Array.from({ length: size }, () =>
    Array(size).fill(null) as Cell[],
  );
  for (const [x, y, cell] of pieces) {
    b[y][x] = cell;
  }
  return b;
}

// --- 14 Steps ---

export const TUTORIAL_STEPS: TutorialStep[] = [
  // 1. Welcome (no board)
  {
    id: "welcome",
    title: "Welcome to Tiao",
    description: (
      <div className="space-y-3">
        <div className="flex justify-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-[2rem] border-2 border-[#f6e8cf]/55 bg-[linear-gradient(180deg,#faefd8,#ecd4a6)] font-display text-5xl text-[#25170d] shadow-[0_24px_48px_-20px_rgba(37,23,13,0.7)]">
            跳
          </span>
        </div>
        <p className="text-center text-lg font-medium text-[#3d2c1a]">
          Tiao (<span className="italic">跳</span>, Chinese for
          &ldquo;jump&rdquo;) is a two-player strategy game where you capture
          pieces by jumping over them.
        </p>
        <p className="text-center text-[#6e5b48]">
          It&apos;s played on a <strong>19&times;19 grid</strong> &mdash; the
          same as a Go board. First to capture{" "}
          <strong>10 enemy pieces</strong> wins. White always moves first.
        </p>
      </div>
    ),
  },

  // 2. Place a Piece (free-place, 5x5)
  {
    id: "place",
    title: "Place a Piece",
    description: (
      <p className="text-[#3d2c1a]">
        Each turn you either <strong>place</strong> a new piece on an empty spot
        or <strong>jump</strong> an enemy to capture it. Place a white piece
        anywhere on the board!
      </p>
    ),
    board: {
      size: 5,
      initialBoard: board(5, [
        [1, 1, "W"],
        [3, 3, "B"],
      ]),
      interaction: { type: "free-place" },
    },
  },

  // 3. Jump to Capture (guided-jump, 5x5)
  {
    id: "jump",
    title: "Jump to Capture",
    description: (
      <p className="text-[#3d2c1a]">
        <strong>Select your white piece</strong>, then{" "}
        <strong>click where to land</strong>. You&apos;ll leap over the enemy
        and capture it!
      </p>
    ),
    board: {
      size: 5,
      // Vertical jump: W(2,1) over B(2,2) to (2,3)
      initialBoard: board(5, [
        [2, 1, "W"],
        [2, 2, "B"],
      ]),
      interaction: {
        type: "guided-jump",
        selectPiece: { x: 2, y: 1 },
        jumpTo: { x: 2, y: 3 },
      },
    },
  },

  // 4. Chain Jumps (chain-jump, 7x7)
  {
    id: "chain",
    title: "Chain Jumps",
    description: (
      <p className="text-[#3d2c1a]">
        After jumping, if you can jump again &mdash;{" "}
        <strong>keep going!</strong> Chain captures for a devastating combo,
        then confirm. You can also stop early if you prefer.
      </p>
    ),
    board: {
      size: 7,
      // Vertical chain: W(3,5)→(3,3) over B(3,4), then (3,3)→(3,1) over B(3,2)
      initialBoard: board(7, [
        [3, 5, "W"],
        [3, 4, "B"],
        [3, 2, "B"],
      ]),
      interaction: {
        type: "chain-jump",
        firstSelect: { x: 3, y: 5 },
      },
    },
  },

  // 5. Confirm & Undo — chain 2 jumps, undo last, confirm with 1
  {
    id: "confirm-undo",
    title: "Confirm & Undo",
    description: (
      <p className="text-[#3d2c1a]">
        After a chain, you might change your mind. <strong>Undo</strong> your
        last jump with the red ✗, then <strong>confirm</strong> to keep the rest!
      </p>
    ),
    board: {
      size: 7,
      // Same vertical chain as step 4: W(3,5)→(3,3) over B(3,4), then (3,3)→(3,1) over B(3,2)
      // After 2 jumps, user undoes the second, then confirms with just the first.
      initialBoard: board(7, [
        [3, 5, "W"],
        [3, 4, "B"],
        [3, 2, "B"],
      ]),
      interaction: {
        type: "chain-undo",
        firstSelect: { x: 3, y: 5 },
        undoAfterJumps: 2,
      },
    },
  },

  // 7. Border Rule — Basic (try-and-fail-border, 5x5, thickBorder, turnColor B)
  {
    id: "border-basic",
    title: "The Border Rule",
    description: (
      <p className="text-[#3d2c1a]">
        The thick edge is the board&apos;s border. You <strong>can&apos;t
        place on the edge</strong> unless an enemy could jump there. Try the
        corner &mdash; it&apos;s blocked! Then place on the legal edge spot
        where White threatens.
      </p>
    ),
    board: {
      size: 5,
      thickBorder: true,
      turnColor: "B",
      // Black's turn. W at (2,2), B at (3,3).
      // Illegal: (0,0) — no enemy can reach
      // Legal: (4,4) — W(2,2) can jump over B(3,3) to (4,4)
      initialBoard: board(5, [
        [2, 2, "W"],
        [3, 3, "B"],
      ]),
      interaction: {
        type: "try-and-fail-border",
        illegal: { x: 0, y: 0 },
        errorMessage: "No enemy can reach this edge!",
        then: { x: 4, y: 4 },
      },
      // Show faint arrow: White's jump path to the corner
      hintArrows: [{ from: { x: 2, y: 2 }, to: { x: 4, y: 4 } }],
    },
  },

  // 7. Border Rule — Chain Jump Defense (free-place, 7x7, thickBorder, turnColor B)
  {
    id: "border-chain",
    title: "Chain Jump Defense",
    description: (
      <p className="text-[#3d2c1a]">
        Even if the enemy needs <strong>multiple jumps</strong> to reach an
        edge, you can still place there to defend. Follow the arrows &mdash;
        White can chain-jump to the corner, so Black can block it!
      </p>
    ),
    board: {
      size: 7,
      thickBorder: true,
      turnColor: "B",
      // W(2,2), B(3,3), B(5,5). Chain: W(2,2)→(4,4)→(6,6).
      // W(1,1) blocks B(3,3) from counter-jumping over W(2,2).
      initialBoard: board(7, [
        [1, 1, "W"],
        [2, 2, "W"],
        [3, 3, "B"],
        [5, 5, "B"],
      ]),
      interaction: { type: "free-place", completionZone: "border" },
      suggestedPos: { x: 6, y: 6 },
      // Green arrows showing White's chain-jump path to the corner
      hintArrows: [
        { from: { x: 2, y: 2 }, to: { x: 4, y: 4 } },
        { from: { x: 4, y: 4 }, to: { x: 6, y: 6 } },
      ],
    },
  },

  // 9. Cluster Rule — Basic (try-and-fail, 7x7)
  {
    id: "cluster-basic",
    title: "The Cluster Rule",
    description: (
      <p className="text-[#3d2c1a]">
        A connected group of same-color stones can&apos;t grow past{" "}
        <strong>10</strong>. Try adding to this cluster of 10 &mdash;
        it&apos;s blocked! Then place elsewhere.
      </p>
    ),
    board: {
      size: 7,
      // 2x5 block of 10 whites at x=2..3, y=1..5
      initialBoard: board(7, [
        [2, 1, "W"], [3, 1, "W"],
        [2, 2, "W"], [3, 2, "W"],
        [2, 3, "W"], [3, 3, "W"],
        [2, 4, "W"], [3, 4, "W"],
        [2, 5, "W"], [3, 5, "W"],
        // Context blacks
        [5, 3, "B"], [5, 5, "B"],
      ]),
      interaction: {
        type: "try-and-fail",
        // (4,3) is orthogonally adjacent to (3,3)=W, cluster already 10
        illegal: { x: 4, y: 3 },
        errorMessage: "That cluster already has 10 — can't add more!",
        then: { x: 5, y: 1 },
      },
    },
  },

  // 10. Cluster Rule — Diagonals Don't Count (free-place, 7x7)
  {
    id: "cluster-diagonal",
    title: "Diagonals Don't Count",
    description: (
      <p className="text-[#3d2c1a]">
        Clusters only count <strong>orthogonal</strong> connections (up, down,
        left, right). Diagonal neighbors are <em>not</em> connected &mdash; so
        you can place diagonally next to a group of 10!
      </p>
    ),
    board: {
      size: 7,
      // 3x3 block at x=2..4 y=2..4 (9 pieces) + (2,5) = 10 total
      // (5,5) is diagonal to (4,4)=W. Ortho neighbors of (5,5): (4,5)=empty, (5,4)=empty. Free!
      initialBoard: board(7, [
        [2, 2, "W"], [3, 2, "W"], [4, 2, "W"],
        [2, 3, "W"], [3, 3, "W"], [4, 3, "W"],
        [2, 4, "W"], [3, 4, "W"], [4, 4, "W"],
        [2, 5, "W"],
      ]),
      interaction: { type: "free-place", requiredPos: { x: 5, y: 5 } },
      suggestedPos: { x: 5, y: 5 },
    },
  },

  // 11. Cluster Rule — Merging Clusters (free-place, 7x7)
  {
    id: "cluster-merge",
    title: "Merging Clusters",
    description: (
      <p className="text-[#3d2c1a]">
        Connecting two <strong>smaller</strong> clusters into one bigger than 10
        is <strong>allowed</strong>! The rule only blocks adding to a cluster
        that&apos;s <em>already</em> at 10. Place between these two groups!
      </p>
    ),
    board: {
      size: 7,
      // Cluster A: 2x3 at x=1..2, y=1..3 (6 pieces)
      // Cluster B: 2x3 at x=4..5, y=1..3 (6 pieces)
      // Gap at x=3. Place at (3,2) to merge — allowed!
      initialBoard: board(7, [
        [1, 1, "W"], [2, 1, "W"],
        [1, 2, "W"], [2, 2, "W"],
        [1, 3, "W"], [2, 3, "W"],
        [4, 1, "W"], [5, 1, "W"],
        [4, 2, "W"], [5, 2, "W"],
        [4, 3, "W"], [5, 3, "W"],
        [3, 5, "B"], [5, 5, "B"],
      ]),
      interaction: { type: "free-place", requiredPos: { x: 3, y: 2 } },
      suggestedPos: { x: 3, y: 2 },
    },
  },

  // 12. Cluster Rule — Enemy Clusters (free-place, 7x7)
  {
    id: "cluster-enemy",
    title: "Enemy Clusters",
    description: (
      <p className="text-[#3d2c1a]">
        The cluster rule only applies to <strong>your own color</strong>. You
        can always place next to enemy clusters, no matter how big they are!
      </p>
    ),
    board: {
      size: 7,
      // Big enemy (black) cluster of 10 in an L-shape:
      // x=2 y=1..4 (4) + x=3 y=1..4 (4) + x=4 y=3..4 (2) = 10 blacks
      initialBoard: board(7, [
        [2, 1, "B"], [3, 1, "B"],
        [2, 2, "B"], [3, 2, "B"],
        [2, 3, "B"], [3, 3, "B"],
        [2, 4, "B"], [3, 4, "B"],
        [4, 3, "B"], [4, 4, "B"],
        [5, 3, "W"],
      ]),
      interaction: { type: "free-place", requiredPos: { x: 1, y: 3 } },
      suggestedPos: { x: 1, y: 3 },
    },
  },

  // 13. Cluster Rule — Jumping Near Clusters (guided-jump, 7x7)
  {
    id: "cluster-jump",
    title: "Jumping Near Clusters",
    description: (
      <p className="text-[#3d2c1a]">
        Jump endpoints can grow a cluster beyond 10! The cluster rule only
        applies to <strong>placement</strong>, not to where your pieces land
        after a jump.
      </p>
    ),
    board: {
      size: 7,
      // Cluster of 10 whites: x=1..2, y=1..5 (2x5 block)
      // W at (5,3), B at (4,3). Jump W(5,3)→(3,3) over B(4,3).
      // After jump: W at (3,3) adj to (2,3)=W in cluster → grows to 11. Allowed!
      initialBoard: board(7, [
        [1, 1, "W"], [2, 1, "W"],
        [1, 2, "W"], [2, 2, "W"],
        [1, 3, "W"], [2, 3, "W"],
        [1, 4, "W"], [2, 4, "W"],
        [1, 5, "W"], [2, 5, "W"],
        [4, 3, "B"],
        [5, 3, "W"],
      ]),
      interaction: {
        type: "guided-jump",
        selectPiece: { x: 5, y: 3 },
        jumpTo: { x: 3, y: 3 },
      },
    },
  },

  // 14. You're Ready! (no board)
  {
    id: "summary",
    title: "You're Ready!",
    description: (
      <div className="space-y-3">
        <div className="rounded-2xl border border-[#d7c39e] bg-[#fffaf3] overflow-hidden max-w-md mx-auto">
          <table className="w-full text-sm">
            <tbody>
              {(
                [
                  ["General", "19×19 grid, starts empty, White moves first"],
                  ["Win", "First to capture 10 enemy pieces wins"],
                  ["Place", "Put a piece on an empty spot"],
                  ["Jump", "Leap over enemy to capture, jumps can be chained"],
                  ["Undo", "Hover over jump start, then red ✗ to undo"],
                  ["Cluster rule", "Can't connect to existing cluster with 10+ stones"],
                  ["Border rule", "Can only place on border to defend from enemy jump"],
                ] as const
              ).map(([rule, desc]) => (
                <tr
                  key={rule}
                  className="border-b border-[#e8dcc8] last:border-0"
                >
                  <td className="px-3 py-2 font-semibold text-[#2b1e14] whitespace-nowrap">
                    {rule}
                  </td>
                  <td className="px-3 py-2 text-[#6e5b48]">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-center text-[#6e5b48] mt-2">
          Time to put your skills to the test!
        </p>
      </div>
    ),
  },
];
