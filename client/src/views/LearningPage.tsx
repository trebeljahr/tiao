"use client";

import { useState } from "react";
import { ColorDot } from "@/components/game/GameShared";
import { PracticeLayout } from "@/components/game/PracticeLayout";
import { PuzzlePlayer } from "@/components/game/PuzzlePlayer";
import { PUZZLES } from "@/lib/puzzles/puzzles";
import { cn } from "@/lib/utils";

export function LearningPage() {
  const [selected, setSelected] = useState(0);
  return (
    <PracticeLayout learning>
      <PuzzlePlayer
        key={PUZZLES[selected].id}
        puzzle={PUZZLES[selected]}
        index={selected}
        total={PUZZLES.length}
        learning
        onNext={selected < PUZZLES.length - 1 ? () => setSelected((index) => index + 1) : undefined}
      />
      <nav aria-label="Choose a lesson" className="mt-10 border-t border-border pt-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Ideas and traps
        </h2>
        <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
          {PUZZLES.map((puzzle, index) => (
            <button
              key={puzzle.id}
              type="button"
              aria-current={selected === index ? "true" : undefined}
              onClick={() => setSelected(index)}
              className={cn(
                "flex min-h-14 items-center gap-3 border-b border-border/60 py-3 text-left text-sm transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-primary",
                selected === index ? "font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              <span className="text-xs tabular-nums opacity-70">
                {String(index + 1).padStart(2, "0")}
              </span>
              <ColorDot color={puzzle.player} className="h-3 w-3" />
              <span>{puzzle.title}</span>
            </button>
          ))}
        </div>
      </nav>
    </PracticeLayout>
  );
}
