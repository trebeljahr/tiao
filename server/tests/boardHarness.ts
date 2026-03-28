import assert from "node:assert/strict";
import {
  GameState,
  PlayerColor,
  Position,
  ScoreState,
  TurnRecord,
  createInitialGameState,
} from "../../shared/src";

type DiagramStateOptions = {
  origin?: Position;
  turn?: PlayerColor;
  score?: Partial<ScoreState>;
  pendingCaptures?: Position[];
  pendingJump?: GameState["pendingJump"];
  history?: TurnRecord[];
};

function parseDiagram(diagram: string): string[][] {
  const rows = diagram
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.includes(" ") ? line.split(/\s+/).filter(Boolean) : line.split("")));

  if (rows.length === 0) {
    throw new Error("Board diagrams need at least one row.");
  }

  const width = rows[0]?.length ?? 0;
  if (width === 0) {
    throw new Error("Board diagrams need at least one column.");
  }

  for (const row of rows) {
    if (row.length !== width) {
      throw new Error("All board-diagram rows must have the same width.");
    }
  }

  return rows;
}

function toTile(token: string): GameState["positions"][number][number] {
  if (token === "." || token === "_") {
    return null;
  }

  if (token === "W") {
    return "white";
  }

  if (token === "B") {
    return "black";
  }

  throw new Error(`Unsupported board token "${token}". Use ".", "W", or "B".`);
}

function toToken(tile: GameState["positions"][number][number]): string {
  if (tile === "white") {
    return "W";
  }

  if (tile === "black") {
    return "B";
  }

  return ".";
}

export function at(origin: Position, x: number, y: number): Position {
  return {
    x: origin.x + x,
    y: origin.y + y,
  };
}

export function stateFromDiagram(diagram: string, options: DiagramStateOptions = {}): GameState {
  const parsed = parseDiagram(diagram);
  const origin = options.origin ?? { x: 0, y: 0 };
  const state = createInitialGameState();
  state.currentTurn = options.turn ?? state.currentTurn;
  state.score = {
    black: options.score?.black ?? 0,
    white: options.score?.white ?? 0,
  };
  state.pendingCaptures = [...(options.pendingCaptures ?? [])];
  state.pendingJump = [...(options.pendingJump ?? [])];
  state.history = [...(options.history ?? [])];

  parsed.forEach((row, y) => {
    row.forEach((token, x) => {
      const position = at(origin, x, y);

      if (
        position.y < 0 ||
        position.y >= state.positions.length ||
        position.x < 0 ||
        position.x >= state.positions[position.y]!.length
      ) {
        throw new Error("Board diagram extends beyond the 19x19 board.");
      }

      state.positions[position.y]![position.x] = toTile(token);
    });
  });

  return state;
}

export function renderRegion(
  state: GameState,
  options: {
    origin?: Position;
    width: number;
    height: number;
  },
): string {
  const origin = options.origin ?? { x: 0, y: 0 };
  const rows: string[] = [];

  for (let y = 0; y < options.height; y += 1) {
    const tokens: string[] = [];
    for (let x = 0; x < options.width; x += 1) {
      const position = at(origin, x, y);
      tokens.push(toToken(state.positions[position.y]![position.x] ?? null));
    }
    rows.push(tokens.join(" "));
  }

  return rows.join("\n");
}

export function assertRegion(
  state: GameState,
  expectedDiagram: string,
  options: {
    origin?: Position;
  } = {},
): void {
  const expected = parseDiagram(expectedDiagram);
  const width = expected[0]!.length;
  const height = expected.length;
  const actual = renderRegion(state, {
    origin: options.origin,
    width,
    height,
  });
  const expectedRendered = expected.map((row) => row.join(" ")).join("\n");

  assert.equal(actual, expectedRendered);
}

export function serializePositions(positions: Position[]): string[] {
  return positions
    .map((position) => `${position.x},${position.y}`)
    .sort((left, right) => left.localeCompare(right));
}
