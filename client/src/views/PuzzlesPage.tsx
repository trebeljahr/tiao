"use client";

import { useState } from "react";
import { ColorDot } from "@/components/game/GameShared";
import { TiaoBoard } from "@/components/game/TiaoBoard";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { describePuzzleMove } from "@/lib/puzzles/puzzleRules";
import { PUZZLES, type Puzzle } from "@/lib/puzzles/puzzles";
import { usePuzzleGame } from "@/lib/puzzles/usePuzzleGame";
import { cn } from "@/lib/utils";

// Keep the existing warm board as the visual focus. A quiet side column holds
// the objective, feedback and studies. Board motion and button transitions
// follow the existing game UI; no extra animation competes with calculation.
function PuzzleStudy({ puzzle, onNext }: { puzzle: Puzzle; onNext?: () => void }) {
  const session = usePuzzleGame(puzzle);
  const [hintsShown, setHintsShown] = useState(0);
  const [solutionShown, setSolutionShown] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const colorName = puzzle.player === "white" ? "White" : "Black";
  const hasPending = session.game.pendingJump.length > 0;

  function reset() {
    session.reset();
    setHintsShown(0);
    setSolutionShown(false);
    setAttempt((value) => value + 1);
  }

  return (
    <section className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] xl:gap-12">
      <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-9rem))]">
        <TiaoBoard
          key={attempt}
          state={session.game}
          selectedPiece={session.selection}
          jumpTargets={session.jumpTargets}
          disabled={session.phase !== "playing"}
          lastMove={session.lastMove}
          showCoordinates
          showJumpControls={false}
          onPointClick={session.click}
          onUndoLastJump={session.undoJump}
          onConfirmJump={session.confirm}
        />
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Columns A–I left to right · Rows 1–9 top to bottom
        </p>
      </div>

      <div className="contents lg:block lg:min-w-0 lg:space-y-6 lg:pt-8">
        <div className="row-start-1 lg:row-auto">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {puzzle.difficulty} · {PUZZLES.findIndex((item) => item.id === puzzle.id) + 1} /{" "}
            {PUZZLES.length}
          </p>
          <h1 className="mt-2 font-display text-3xl leading-tight text-foreground">
            {puzzle.title}
          </h1>
          <p className="mt-4 flex items-center gap-2 text-lg font-semibold">
            <ColorDot color={puzzle.player} /> {colorName} to move
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {puzzle.turns === 1
              ? "Win in one turn."
              : "Win in two of your turns against any reply."}
          </p>
        </div>

        <section className="flex gap-6 border-y border-border py-4" aria-label="Capture scores">
          {(["white", "black"] as const).map((color) => (
            <div key={color} className="flex items-center gap-2 text-sm">
              <ColorDot color={color} />
              <span>{color === "white" ? "White" : "Black"}</span>
              <strong className="text-xl tabular-nums">{session.game.score[color]}</strong>
            </div>
          ))}
          <span className="ml-auto self-center text-xs text-muted-foreground">First to 10</span>
        </section>

        <div className="space-y-3">
          <p
            role="status"
            aria-live="polite"
            className={cn(
              "min-h-12 text-sm leading-relaxed",
              session.phase === "solved" ? "font-semibold text-primary" : "text-foreground",
            )}
          >
            {session.feedback ||
              (hasPending
                ? `${session.game.pendingJump.length} capture${session.game.pendingJump.length === 1 ? "" : "s"} pending. Continue or confirm to end your turn.`
                : "You may place a stone or choose a capture. Plan the full turn before you confirm.")}
          </p>
          {hasPending && session.phase === "playing" && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={session.confirm}>Confirm turn</Button>
              <Button variant="outline" onClick={session.undoJump}>
                Undo jump
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={reset}>
              Reset puzzle
            </Button>
            {session.phase === "solved" && onNext && <Button onClick={onNext}>Next puzzle</Button>}
          </div>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={hintsShown === puzzle.hints.length}
              onClick={() => setHintsShown((count) => count + 1)}
            >
              {hintsShown ? "Another hint" : "Hint"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={solutionShown}
              onClick={() => setSolutionShown((shown) => !shown)}
            >
              {solutionShown ? "Hide solution" : "Show solution"}
            </Button>
          </div>
          {puzzle.hints.slice(0, hintsShown).map((hint, index) => (
            <p key={hint} className="text-sm leading-relaxed text-muted-foreground">
              <span className="mr-2 font-semibold text-foreground">{index + 1}.</span>
              {hint}
            </p>
          ))}
          {(solutionShown || session.phase === "solved") && (
            <div className="space-y-3 text-sm leading-relaxed">
              <h2 className="font-semibold">Why it works</h2>
              <p>{puzzle.explanation}</p>
              <ol
                className="space-y-1 border-l-2 border-primary/30 pl-3"
                aria-label="Example solution"
              >
                {puzzle.line.map((move, index) => (
                  <li key={describePuzzleMove(move)}>
                    <span className="mr-2 text-muted-foreground">
                      {index % 2 === 0 ? colorName : colorName === "White" ? "Black" : "White"}
                    </span>
                    {describePuzzleMove(move)}
                  </li>
                ))}
              </ol>
              {puzzle.turns > 1 && (
                <p className="text-xs text-muted-foreground">
                  One example reply shown. Every legal reply is checked.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function PuzzlesPage() {
  const { auth, onOpenAuth, onLogout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  return (
    <div className="min-h-screen">
      <Navbar
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((open) => !open)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />
      <main className="mx-auto max-w-7xl px-4 pb-12 pt-20 sm:px-6 sm:pt-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <p className="font-display text-xl">Puzzle studies</p>
          <p className="text-xs text-muted-foreground">
            Development only · Composed positions · 9 × 9
          </p>
        </div>
        <PuzzleStudy
          key={PUZZLES[selected].id}
          puzzle={PUZZLES[selected]}
          onNext={
            selected < PUZZLES.length - 1 ? () => setSelected((index) => index + 1) : undefined
          }
        />
        <nav aria-label="Choose a puzzle" className="mt-10 border-t border-border pt-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Studies
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
      </main>
    </div>
  );
}
