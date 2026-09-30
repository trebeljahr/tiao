"use client";

import { useMemo } from "react";
import { InteractiveMiniBoard } from "./InteractiveMiniBoard";
import type { StepBoardConfig } from "./ruleExamples";

/** A single playable example, with no tutorial navigation or progress state. */
export function RuleExample({
  config,
  onComplete,
  resetKey,
  t,
  presentation = "inline",
}: {
  config: StepBoardConfig;
  onComplete: () => void;
  resetKey: number;
  t: (key: string) => string;
  presentation?: "inline" | "guided";
}) {
  const board = useMemo(
    () => (presentation === "inline" ? { ...config, overlayHint: undefined } : config),
    [config, presentation],
  );
  return (
    <InteractiveMiniBoard config={board} active resetKey={resetKey} onComplete={onComplete} t={t} />
  );
}
