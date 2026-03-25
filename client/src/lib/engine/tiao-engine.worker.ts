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

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === "cancel") {
    if (currentAbort && currentId === msg.id) {
      currentAbort.aborted = true;
    }
    return;
  }

  if (msg.type === "search") {
    currentAbort = { aborted: false };
    currentId = msg.id;

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

      if (currentAbort.aborted) {
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
  }
};
