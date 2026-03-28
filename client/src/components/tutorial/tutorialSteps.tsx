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
  const b: Cell[][] = Array.from({ length: size }, () => Array(size).fill(null) as Cell[]);
  for (const [x, y, cell] of pieces) {
    b[y][x] = cell;
  }
  return b;
}

// --- Translation-aware step builder ---

type T = (key: string) => string;

export function getTutorialSteps(t: T): TutorialStep[] {
  return [
    // 1. Welcome (no board)
    {
      id: "welcome",
      title: t("_welcome_title"),
      description: (
        <div className="space-y-3">
          <div className="flex justify-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-[2rem] border-2 border-[#f6e8cf]/55 bg-[linear-gradient(180deg,#faefd8,#ecd4a6)] font-display text-5xl text-[#25170d] shadow-[0_24px_48px_-20px_rgba(37,23,13,0.7)]">
              跳
            </span>
          </div>
          <p className="text-center text-lg font-medium text-[#3d2c1a]">{t("_welcome_intro")}</p>
          <p className="text-center text-[#6e5b48]">{t("_welcome_details")}</p>
        </div>
      ),
    },

    // 2. Place a Piece (free-place, 5x5)
    {
      id: "place",
      title: t("_place_title"),
      description: <p className="text-[#3d2c1a]">{t("_place_desc")}</p>,
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
      title: t("_jump_title"),
      description: <p className="text-[#3d2c1a]">{t("_jump_desc")}</p>,
      board: {
        size: 5,
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
      title: t("_chain_title"),
      description: <p className="text-[#3d2c1a]">{t("_chain_desc")}</p>,
      board: {
        size: 7,
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

    // 5. Confirm & Undo
    {
      id: "confirm-undo",
      title: t("_confirmUndo_title"),
      description: <p className="text-[#3d2c1a]">{t("_confirmUndo_desc")}</p>,
      board: {
        size: 7,
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

    // 6. Border Rule — Basic
    {
      id: "border-basic",
      title: t("_borderBasic_title"),
      description: <p className="text-[#3d2c1a]">{t("_borderBasic_desc")}</p>,
      board: {
        size: 5,
        thickBorder: true,
        turnColor: "B",
        initialBoard: board(5, [
          [2, 2, "W"],
          [3, 3, "B"],
        ]),
        interaction: {
          type: "try-and-fail-border",
          illegal: { x: 0, y: 0 },
          errorMessage: t("_borderBasic_error"),
          then: { x: 4, y: 4 },
        },
        hintArrows: [{ from: { x: 2, y: 2 }, to: { x: 4, y: 4 } }],
      },
    },

    // 7. Border Rule — Chain Jump Defense
    {
      id: "border-chain",
      title: t("_borderChain_title"),
      description: <p className="text-[#3d2c1a]">{t("_borderChain_desc")}</p>,
      board: {
        size: 7,
        thickBorder: true,
        turnColor: "B",
        initialBoard: board(7, [
          [1, 1, "W"],
          [2, 2, "W"],
          [3, 3, "B"],
          [5, 5, "B"],
        ]),
        interaction: { type: "free-place", completionZone: "border" },
        suggestedPos: { x: 6, y: 6 },
        hintArrows: [
          { from: { x: 2, y: 2 }, to: { x: 4, y: 4 } },
          { from: { x: 4, y: 4 }, to: { x: 6, y: 6 } },
        ],
      },
    },

    // 8. Cluster Rule — Basic
    {
      id: "cluster-basic",
      title: t("_clusterBasic_title"),
      description: <p className="text-[#3d2c1a]">{t("_clusterBasic_desc")}</p>,
      board: {
        size: 7,
        initialBoard: board(7, [
          [2, 1, "W"],
          [3, 1, "W"],
          [2, 2, "W"],
          [3, 2, "W"],
          [2, 3, "W"],
          [3, 3, "W"],
          [2, 4, "W"],
          [3, 4, "W"],
          [2, 5, "W"],
          [3, 5, "W"],
          [5, 3, "B"],
          [5, 5, "B"],
        ]),
        interaction: {
          type: "try-and-fail",
          illegal: { x: 4, y: 3 },
          errorMessage: t("_clusterBasic_error"),
          then: { x: 5, y: 1 },
        },
      },
    },

    // 9. Cluster Rule — Diagonals Don't Count
    {
      id: "cluster-diagonal",
      title: t("_clusterDiagonal_title"),
      description: <p className="text-[#3d2c1a]">{t("_clusterDiagonal_desc")}</p>,
      board: {
        size: 7,
        initialBoard: board(7, [
          [2, 2, "W"],
          [3, 2, "W"],
          [4, 2, "W"],
          [2, 3, "W"],
          [3, 3, "W"],
          [4, 3, "W"],
          [2, 4, "W"],
          [3, 4, "W"],
          [4, 4, "W"],
          [2, 5, "W"],
        ]),
        interaction: { type: "free-place", requiredPos: { x: 5, y: 5 } },
        suggestedPos: { x: 5, y: 5 },
      },
    },

    // 10. Cluster Rule — Merging Clusters
    {
      id: "cluster-merge",
      title: t("_clusterMerge_title"),
      description: <p className="text-[#3d2c1a]">{t("_clusterMerge_desc")}</p>,
      board: {
        size: 7,
        initialBoard: board(7, [
          [1, 1, "W"],
          [2, 1, "W"],
          [1, 2, "W"],
          [2, 2, "W"],
          [1, 3, "W"],
          [2, 3, "W"],
          [4, 1, "W"],
          [5, 1, "W"],
          [4, 2, "W"],
          [5, 2, "W"],
          [4, 3, "W"],
          [5, 3, "W"],
          [3, 5, "B"],
          [5, 5, "B"],
        ]),
        interaction: { type: "free-place", requiredPos: { x: 3, y: 2 } },
        suggestedPos: { x: 3, y: 2 },
      },
    },

    // 11. Cluster Rule — Enemy Clusters
    {
      id: "cluster-enemy",
      title: t("_clusterEnemy_title"),
      description: <p className="text-[#3d2c1a]">{t("_clusterEnemy_desc")}</p>,
      board: {
        size: 7,
        initialBoard: board(7, [
          [2, 1, "B"],
          [3, 1, "B"],
          [2, 2, "B"],
          [3, 2, "B"],
          [2, 3, "B"],
          [3, 3, "B"],
          [2, 4, "B"],
          [3, 4, "B"],
          [4, 3, "B"],
          [4, 4, "B"],
          [5, 3, "W"],
        ]),
        interaction: { type: "free-place", requiredPos: { x: 1, y: 3 } },
        suggestedPos: { x: 1, y: 3 },
      },
    },

    // 12. Cluster Rule — Jumping Near Clusters
    {
      id: "cluster-jump",
      title: t("_clusterJump_title"),
      description: <p className="text-[#3d2c1a]">{t("_clusterJump_desc")}</p>,
      board: {
        size: 7,
        initialBoard: board(7, [
          [1, 1, "W"],
          [2, 1, "W"],
          [1, 2, "W"],
          [2, 2, "W"],
          [1, 3, "W"],
          [2, 3, "W"],
          [1, 4, "W"],
          [2, 4, "W"],
          [1, 5, "W"],
          [2, 5, "W"],
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

    // 13. You're Ready! (no board)
    {
      id: "summary",
      title: t("_summary_title"),
      description: (
        <div className="space-y-3">
          <div className="rounded-2xl border border-[#d7c39e] bg-[#fffaf3] overflow-hidden max-w-md mx-auto">
            <table className="w-full text-sm">
              <tbody>
                {(
                  [
                    [t("_summary_ruleGeneral"), t("_summary_ruleGeneralDesc")],
                    [t("_summary_ruleWin"), t("_summary_ruleWinDesc")],
                    [t("_summary_rulePlace"), t("_summary_rulePlaceDesc")],
                    [t("_summary_ruleJump"), t("_summary_ruleJumpDesc")],
                    [t("_summary_ruleUndo"), t("_summary_ruleUndoDesc")],
                    [t("_summary_ruleCluster"), t("_summary_ruleClusterDesc")],
                    [t("_summary_ruleBorder"), t("_summary_ruleBorderDesc")],
                  ] as const
                ).map(([rule, desc]) => (
                  <tr key={rule} className="border-b border-[#e8dcc8] last:border-0">
                    <td className="px-3 py-2 font-semibold text-[#2b1e14] whitespace-nowrap">
                      {rule}
                    </td>
                    <td className="px-3 py-2 text-[#6e5b48]">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-center text-[#6e5b48] mt-2">{t("_summary_ready")}</p>
        </div>
      ),
    },
  ];
}
