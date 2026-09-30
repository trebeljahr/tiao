import type React from "react";
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
      successAt: Pos;
    }
  | {
      type: "try-and-fail-border";
      illegal: Pos;
      errorMessage: string;
      successAt: Pos;
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
  /** Short instruction shown as an overlay on the board, dismissed on first interaction */
  overlayHint?: string;
};

export type RuleExampleDefinition = {
  id: string;
  title: string;
  description: React.ReactNode;
  board: StepBoardConfig;
};

// --- Helper ---

function board(size: number, pieces: Array<[number, number, Cell]>): Cell[][] {
  const b: Cell[][] = Array.from({ length: size }, () => Array(size).fill(null) as Cell[]);
  for (const [x, y, cell] of pieces) {
    b[y][x] = cell;
  }
  return b;
}

type T = (key: string) => string;

// Independent examples. The guided tutorial chooses their order separately.
const examples = {
  place: (t: T): RuleExampleDefinition => ({
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
      suggestedPos: { x: 2, y: 2 },
      overlayHint: t("_place_desc"),
    },
  }),
  jump: (t: T): RuleExampleDefinition => ({
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
      overlayHint: t("_jump_desc"),
    },
  }),
  chain: (t: T): RuleExampleDefinition => ({
    id: "chain",
    title: t("_chain_title"),
    description: <p className="text-[#3d2c1a]">{t("_chain_desc")}</p>,
    board: {
      size: 7,
      initialBoard: board(7, [
        [1, 5, "W"],
        [1, 4, "B"],
        [2, 2, "B"],
        [4, 1, "B"],
      ]),
      interaction: {
        type: "chain-jump",
        firstSelect: { x: 1, y: 5 },
      },
      overlayHint: t("_chain_desc"),
    },
  }),
  "confirm-undo": (t: T): RuleExampleDefinition => ({
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
      overlayHint: t("_confirmUndo_desc"),
    },
  }),
  "border-basic": (t: T): RuleExampleDefinition => ({
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
        successAt: { x: 4, y: 4 },
      },
      hintArrows: [{ from: { x: 2, y: 2 }, to: { x: 4, y: 4 } }],
      overlayHint: t("_borderBasic_desc"),
    },
  }),
  "border-chain": (t: T): RuleExampleDefinition => ({
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
      overlayHint: t("_borderChain_desc"),
    },
  }),
  "cluster-basic": (t: T): RuleExampleDefinition => ({
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
        successAt: { x: 5, y: 1 },
      },
      overlayHint: t("_clusterBasic_desc"),
    },
  }),
  "cluster-diagonal": (t: T): RuleExampleDefinition => ({
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
      overlayHint: t("_clusterDiagonal_desc"),
    },
  }),
  "cluster-merge": (t: T): RuleExampleDefinition => ({
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
      overlayHint: t("_clusterMerge_desc"),
    },
  }),
  "cluster-enemy": (t: T): RuleExampleDefinition => ({
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
      overlayHint: t("_clusterEnemy_desc"),
    },
  }),
  "cluster-jump": (t: T): RuleExampleDefinition => ({
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
      overlayHint: t("_clusterJump_desc"),
    },
  }),
};

export type RuleExampleId = keyof typeof examples;

export function getRuleExample(id: RuleExampleId, t: T): RuleExampleDefinition {
  return examples[id](t);
}
