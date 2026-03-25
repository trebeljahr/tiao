import { findBestMove, type EngineConfig, type SearchResult } from "./tiao-engine";
import type { GameState } from "@shared";

export type WorkerRequest =
  | { type: "search"; id: number; state: GameState; config: EngineConfig }
  | { type: "cancel"; id: number };

export type WorkerResponse =
  | { type: "result"; id: number; result: SearchResult }
  | { type: "error"; id: number; error: string }
  | { type: "cancelled"; id: number }
  | { type: "progress"; id: number; progress: number };

let currentAbort: { aborted: boolean } | null = null;
let currentId: number | null = null;
// Track whether the abort was triggered externally (UI cancel) vs internally
// (engine time budget expired). The engine sets abort.aborted=true when the
// time budget runs out, but that's a soft stop — the result is still valid.
let externallyCancelled = false;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === "cancel") {
    if (currentAbort && currentId === msg.id) {
      externallyCancelled = true;
      currentAbort.aborted = true;
    }
    return;
  }

  if (msg.type === "search") {
    currentAbort = { aborted: false };
    currentId = msg.id;
    externallyCancelled = false;

    const config: EngineConfig = {
      ...msg.config,
      onProgress: (progress: number) => {
        self.postMessage({
          type: "progress",
          id: msg.id,
          progress,
        } satisfies WorkerResponse);
      },
    };

    try {
      const result = findBestMove(msg.state, config, currentAbort);

      if (externallyCancelled) {
        self.postMessage({ type: "cancelled", id: msg.id } satisfies WorkerResponse);
      } else if (result) {
        self.postMessage({ type: "result", id: msg.id, result } satisfies WorkerResponse);
      } else {
        self.postMessage({
          type: "error",
          id: msg.id,
          error: "No legal moves found",
        } satisfies WorkerResponse);
      }
    } catch (err) {
      self.postMessage({
        type: "error",
        id: msg.id,
        error: String(err),
      } satisfies WorkerResponse);
    }

    currentAbort = null;
    currentId = null;
    externallyCancelled = false;
  }
};
