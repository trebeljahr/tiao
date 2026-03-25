import {
  type GameState,
  type Position,
  type PlayerColor,
  type RuleResult,
  placePiece,
  jumpPiece,
  confirmPendingJump,
} from "@shared";
import type { WorkerRequest, WorkerResponse } from "./engine/tiao-engine.worker";

export const COMPUTER_COLOR: PlayerColor = "black";
export const COMPUTER_THINK_MS = 440;

export type AIDifficulty = 1 | 2 | 3;

export type ComputerTurnPlan =
  | { type: "place"; position: Position; score: number }
  | { type: "jump"; from: Position; path: Position[]; score: number };

// ─── Worker Management ───────────────────────────────────────────────

let worker: Worker | null = null;
let requestId = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL("./engine/tiao-engine.worker.ts", import.meta.url),
      { type: "module" },
    );
  }
  return worker;
}

export function requestComputerMove(
  state: GameState,
  level: AIDifficulty,
  onProgress?: (progress: number) => void,
): { promise: Promise<ComputerTurnPlan | null>; cancel: () => void } {
  const id = ++requestId;
  const w = getWorker();
  let cancelled = false;

  const promise = new Promise<ComputerTurnPlan | null>((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id !== id) return;

      if (e.data.type === "progress") {
        onProgress?.(e.data.progress);
        return;
      }

      w.removeEventListener("message", handler);

      if (e.data.type === "cancelled") {
        resolve(null);
        return;
      }
      if (e.data.type === "error") {
        reject(new Error(e.data.error));
        return;
      }

      const { move, score } = e.data.result;
      resolve({ ...move, score } as ComputerTurnPlan);
    };
    w.addEventListener("message", handler);
  });

  w.postMessage({
    type: "search",
    id,
    state,
    config: { level, color: COMPUTER_COLOR },
  } satisfies WorkerRequest);

  const cancel = () => {
    if (!cancelled) {
      cancelled = true;
      w.postMessage({ type: "cancel", id } satisfies WorkerRequest);
    }
  };

  return { promise, cancel };
}

// ─── Move Execution ──────────────────────────────────────────────────

export function applyComputerTurnPlan(
  state: GameState,
  plan: ComputerTurnPlan,
): RuleResult<GameState> {
  if (plan.type === "place") {
    return placePiece(state, plan.position);
  }

  let nextState = state;
  let from = plan.from;

  for (const destination of plan.path) {
    const jumped = jumpPiece(nextState, from, destination);
    if (!jumped.ok) return jumped;
    nextState = jumped.value;
    from = destination;
  }

  return confirmPendingJump(nextState);
}
