"use client";

import { useCallback, useEffect, useState } from "react";
import { PracticeLayout } from "@/components/game/PracticeLayout";
import { PuzzlePlayer } from "@/components/game/PuzzlePlayer";
import { Button } from "@/components/ui/button";
import { PUZZLE_POOL } from "@/lib/puzzles/puzzlePool";
import {
  nextPuzzle,
  PUZZLE_PROGRESS_KEY,
  type PuzzleProgress,
  readPuzzleProgress,
} from "@/lib/puzzles/puzzleProgress";

const ids = PUZZLE_POOL.map((puzzle) => puzzle.id);

export function PuzzlesPage() {
  const [progress, setProgress] = useState<PuzzleProgress>(() => readPuzzleProgress(null, ids));
  const [loaded, setLoaded] = useState(false);
  const [turns, setTurns] = useState("all");
  useEffect(() => {
    try {
      setProgress(readPuzzleProgress(localStorage.getItem(PUZZLE_PROGRESS_KEY), ids));
    } catch {
      /* Storage may be disabled. */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(PUZZLE_PROGRESS_KEY, JSON.stringify(progress));
      } catch {
        /* Playing never requires storage. */
      }
    }
  }, [progress, loaded]);
  const puzzles = PUZZLE_POOL.filter((puzzle) => turns === "all" || puzzle.turns === Number(turns));
  const puzzle = puzzles.find((item) => item.id === progress.currentId) ?? puzzles[0];
  const selected = PUZZLE_POOL.findIndex((item) => item.id === puzzle.id);
  const solved = useCallback((id: string) => {
    setProgress((previous) =>
      previous.solved.includes(id) ? previous : { ...previous, solved: [...previous.solved, id] },
    );
  }, []);
  function advance(shuffle = false) {
    setProgress((previous) =>
      nextPuzzle(
        puzzles.map((item) => item.id),
        { ...previous, currentId: puzzle.id },
        shuffle ? Math.random : undefined,
      ),
    );
  }
  function choose(currentId: string) {
    setProgress((previous) => ({
      ...previous,
      currentId,
      seen: [...new Set([...previous.seen, currentId])],
    }));
  }
  return (
    <PracticeLayout>
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <label className="sr-only" htmlFor="puzzle-number">
          Choose a puzzle
        </label>
        <select
          id="puzzle-number"
          value={puzzle.id}
          onChange={(event) => choose(event.target.value)}
          className="h-10 rounded-lg border border-border bg-background px-3"
        >
          {puzzles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
              {progress.solved.includes(item.id) ? " · Solved" : ""}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="puzzle-turns">
          Turn limit
        </label>
        <select
          id="puzzle-turns"
          value={turns}
          onChange={(event) => {
            const limit = event.target.value;
            setTurns(limit);
            const choices = PUZZLE_POOL.filter(
              (item) => limit === "all" || item.turns === Number(limit),
            );
            choose(choices.find((item) => item.id === puzzle.id)?.id ?? choices[0].id);
          }}
          className="h-10 rounded-lg border border-border bg-background px-3"
        >
          <option value="all">All puzzles</option>
          <option value="1">One turn</option>
          <option value="2">Two turns</option>
        </select>
        <Button variant="ghost" onClick={() => advance(true)}>
          Shuffle
        </Button>
        <output className="ml-auto text-xs text-muted-foreground" aria-label="Puzzle progress">
          Solved {progress.solved.length} / {PUZZLE_POOL.length}
        </output>
      </div>
      <PuzzlePlayer
        key={puzzle.id}
        puzzle={puzzle}
        index={selected}
        total={PUZZLE_POOL.length}
        onNext={() => advance()}
        onSolved={solved}
      />
    </PracticeLayout>
  );
}
