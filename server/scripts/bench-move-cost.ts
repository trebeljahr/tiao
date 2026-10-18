/**
 * Per-move cost benchmark for the shared rules engine and the Mongo room store.
 *
 * Plays one deterministic game (seeded, scoreToWin raised so it does not end
 * early) and reports, at 50 / 200 / 400 history entries:
 *
 *   1. engine: time and heap allocation of one `placePiece` call
 *   2. mongo:  one applyAction-equivalent round trip against a scratch
 *              database: getRoom → rules → saveRoom → snapshot JSON, plus the
 *              BSON bytes sent to and received from MongoDB
 *
 * Usage (from server/):
 *   node --import tsx scripts/bench-move-cost.ts
 *   MONGODB_URI=mongodb://127.0.0.1:27017 node --import tsx scripts/bench-move-cost.ts
 *   BENCH_SKIP_MONGO=1 node --import tsx scripts/bench-move-cost.ts
 *
 * The scratch database (tiao_bench_<pid>) is dropped at the end.
 */

import { performance } from "node:perf_hooks";
import v8 from "node:v8";
import { BSON } from "mongodb";
import mongoose from "mongoose";
import {
  confirmPendingJump,
  createInitialGameState,
  type GameState,
  getJumpTargets,
  getSelectableJumpOrigins,
  isGameOver,
  jumpPiece,
  type Position,
  placePiece,
  type RuleResult,
} from "../../shared/src";
import { MongoGameRoomStore } from "../game/gameStore";

const CHECKPOINTS = [50, 200, 400];
const ENGINE_ITERATIONS = 2000;
const MONGO_RUNS = 3;
const WINDOW = 20;

type Action =
  | { type: "place"; position: Position }
  | { type: "jump"; from: Position; to: Position }
  | { type: "confirm" };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function applyAction(state: GameState, action: Action): RuleResult<GameState> {
  switch (action.type) {
    case "place":
      return placePiece(state, action.position);
    case "jump":
      return jumpPiece(state, action.from, action.to);
    case "confirm":
      return confirmPendingJump(state);
  }
}

function findPlacement(state: GameState, rng: () => number): Position | null {
  const empty: Position[] = [];
  for (let y = 0; y < state.boardSize; y++) {
    for (let x = 0; x < state.boardSize; x++) {
      if (state.positions[y][x] === null) empty.push({ x, y });
    }
  }
  for (let i = empty.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [empty[i], empty[j]] = [empty[j], empty[i]];
  }
  for (const position of empty) {
    if (placePiece(state, position).ok) return position;
  }
  return null;
}

/** Deterministic game: jumps when available (60%), otherwise a random legal placement. */
function generateGame(targetHistory: number): {
  actions: Action[];
  /** State with `history.length === n` and no pending jump, keyed by n. */
  statesByLength: Map<number, GameState>;
  final: GameState;
} {
  const rng = mulberry32(0x7140);
  let state = createInitialGameState({ boardSize: 19, scoreToWin: 10_000 });
  const actions: Action[] = [];
  const statesByLength = new Map<number, GameState>([[0, state]]);

  const step = (action: Action) => {
    const result = applyAction(state, action);
    if (!result.ok) throw new Error(`generator produced illegal ${action.type}: ${result.reason}`);
    actions.push(action);
    state = result.value;
  };

  while (state.history.length < targetHistory && !isGameOver(state)) {
    const origins = getSelectableJumpOrigins(state);
    if (origins.length > 0 && rng() < 0.6) {
      const from = origins[Math.floor(rng() * origins.length)];
      const targets = getJumpTargets(state, from, state.currentTurn);
      step({ type: "jump", from, to: targets[Math.floor(rng() * targets.length)] });
      step({ type: "confirm" });
    } else {
      const position = findPlacement(state, rng);
      if (!position) break;
      step({ type: "place", position });
    }
    if (state.pendingJump.length === 0) statesByLength.set(state.history.length, state);
  }

  return { actions, statesByLength, final: state };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Cumulative V8 allocation counter; missing from @types/node 22, NaN where unsupported.
const allocated = () =>
  (v8.getHeapStatistics() as { total_allocated_bytes?: number }).total_allocated_bytes ??
  Number.NaN;
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

function measurePlace(state: GameState, position: Position): { us: number; bytes: number } {
  for (let i = 0; i < 200; i++) placePiece(state, position);
  const samples: number[] = [];
  let bytes = 0;
  for (let round = 0; round < 5; round++) {
    const a0 = allocated();
    const t0 = performance.now();
    for (let i = 0; i < ENGINE_ITERATIONS; i++) placePiece(state, position);
    samples.push(((performance.now() - t0) * 1000) / ENGINE_ITERATIONS);
    bytes += (allocated() - a0) / ENGINE_ITERATIONS;
  }
  return { us: median(samples), bytes: bytes / 5 };
}

function benchEngine(statesByLength: Map<number, GameState>) {
  console.log("\nengine: one placePiece call (control = same board, history emptied)");
  console.log("history  µs/move   alloc/move   control µs   control alloc");
  // Warm the JIT on every checkpoint first so the first row is not penalised.
  for (const n of CHECKPOINTS) {
    const state = statesByLength.get(n);
    const position = state && findPlacement(state, mulberry32(n));
    if (state && position) measurePlace(state, position);
  }
  for (const n of CHECKPOINTS) {
    const state = statesByLength.get(n);
    const position = state && findPlacement(state, mulberry32(n));
    if (!state || !position) {
      console.log(`${String(n).padStart(7)}  (game did not reach this length)`);
      continue;
    }
    const full = measurePlace(state, position);
    const control = measurePlace({ ...state, history: [] }, position);
    console.log(
      [
        String(n).padStart(7),
        full.us.toFixed(1).padStart(7),
        kb(full.bytes).padStart(11),
        control.us.toFixed(1).padStart(11),
        kb(control.bytes).padStart(14),
      ].join("  "),
    );
  }
}

type MongoSample = { historyLength: number; ms: number; alloc: number; sent: number; recv: number };

async function playMongoGame(
  store: MongoGameRoomStore,
  actions: Action[],
  roomId: string,
  bytes: { sent: number; recv: number },
): Promise<MongoSample[]> {
  await store.createRoom({
    id: roomId,
    roomType: "direct",
    status: "active",
    state: createInitialGameState({ boardSize: 19, scoreToWin: 10_000 }),
    rematch: null,
    takeback: null,
    seats: {
      white: { playerId: "bench-white", displayName: "White", kind: "account" },
      black: { playerId: "bench-black", displayName: "Black", kind: "account" },
    },
    timeControl: null,
    clockMs: null,
    lastMoveAt: null,
    firstMoveDeadline: null,
  });

  const samples: MongoSample[] = [];
  for (const action of actions) {
    const sent0 = bytes.sent;
    const recv0 = bytes.recv;
    const a0 = allocated();
    const t0 = performance.now();

    const room = await store.getRoom(roomId);
    if (!room) throw new Error("room vanished");
    const result = applyAction(room.state, action);
    if (!result.ok) throw new Error(`illegal ${action.type} in mongo replay: ${result.reason}`);
    const now = Date.now();
    for (let i = room.state.history.length; i < result.value.history.length; i++) {
      const rec = result.value.history[i];
      if (rec.type === "put" || rec.type === "jump") rec.timestamp = now;
    }
    const saved = await store.saveRoom({ ...room, state: result.value, takeback: null });
    JSON.stringify({ type: "snapshot", snapshot: { gameId: saved.id, state: saved.state } });

    samples.push({
      historyLength: saved.state.history.length,
      ms: performance.now() - t0,
      alloc: allocated() - a0,
      sent: bytes.sent - sent0,
      recv: bytes.recv - recv0,
    });
  }
  return samples;
}

async function benchMongo(actions: Action[]) {
  const uri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";
  const dbName = `tiao_bench_${process.pid}`;
  await mongoose.connect(uri, { dbName, monitorCommands: true, serverSelectionTimeoutMS: 3000 });

  const bytes = { sent: 0, recv: 0 };
  let counting = false;
  const client = mongoose.connection.getClient();
  client.on("commandStarted", (event) => {
    if (counting) bytes.sent += BSON.calculateObjectSize(event.command);
  });
  client.on("commandSucceeded", (event) => {
    if (counting) bytes.recv += BSON.calculateObjectSize(event.reply as BSON.Document);
  });

  try {
    const store = new MongoGameRoomStore();
    // Warm-up run, then timed runs without byte counting, then one counted run.
    await playMongoGame(store, actions.slice(0, 100), "BENCHWARM", bytes);
    const timedRuns: MongoSample[][] = [];
    for (let run = 0; run < MONGO_RUNS; run++) {
      timedRuns.push(await playMongoGame(store, actions, `BENCH${run}`, bytes));
    }
    counting = true;
    const counted = await playMongoGame(store, actions, "BENCHBYTES", bytes);
    counting = false;

    console.log(
      `\nmongo: getRoom → rules → saveRoom → snapshot JSON (median of ${WINDOW} actions before each checkpoint, ${MONGO_RUNS} runs)`,
    );
    console.log("history  ms/action   alloc/action   sent/action   recv/action");
    for (const n of CHECKPOINTS) {
      const inWindow = (s: MongoSample) => s.historyLength <= n && s.historyLength > n - WINDOW;
      const timed = timedRuns.flatMap((run) => run.filter(inWindow));
      const sized = counted.filter(inWindow);
      if (timed.length === 0) continue;
      console.log(
        [
          String(n).padStart(7),
          median(timed.map((s) => s.ms))
            .toFixed(2)
            .padStart(9),
          kb(median(timed.map((s) => s.alloc))).padStart(13),
          kb(median(sized.map((s) => s.sent))).padStart(12),
          kb(median(sized.map((s) => s.recv))).padStart(12),
        ].join("  "),
      );
    }
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}

async function main() {
  const target = Math.max(...CHECKPOINTS);
  const { actions, statesByLength, final } = generateGame(target);
  console.log(
    `game: ${actions.length} actions, ${final.history.length} history entries, ` +
      `score W${final.score.white}/B${final.score.black}, ${final.currentTurn} to move`,
  );

  benchEngine(statesByLength);
  if (process.env.BENCH_SKIP_MONGO !== "1") await benchMongo(actions);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
