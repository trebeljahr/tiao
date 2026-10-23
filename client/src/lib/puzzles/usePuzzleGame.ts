import {
  arePositionsEqual,
  confirmPendingJump,
  type GameState,
  getJumpTargets,
  getPendingJumpDestination,
  getWinner,
  isGameOver,
  jumpPiece,
  type Position,
  placePiece,
  undoPendingJumpStep,
} from "@shared";
import { useEffect, useState } from "react";
import {
  canForcePuzzleWin,
  describePuzzleMove,
  type PuzzleTurn,
  puzzleMoveKey,
  puzzleTurns,
} from "./puzzleRules";
import { createPuzzleState, type Puzzle } from "./puzzles";

export function usePuzzleGame(puzzle: Puzzle) {
  const [game, setGame] = useState(() => createPuzzleState(puzzle));
  const [selection, setSelection] = useState<Position | null>(null);
  const [phase, setPhase] = useState<"playing" | "reply" | "failed" | "solved">("playing");
  const [turnsPlayed, setTurnsPlayed] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [reply, setReply] = useState<PuzzleTurn | null>(null);

  useEffect(() => {
    if (phase !== "reply" || !reply) return;
    const timer = setTimeout(() => {
      setGame(reply.state);
      setFeedback(
        `${reply.state.currentTurn === "white" ? "Black" : "White"} played ${describePuzzleMove(reply.move)}. Find the win.`,
      );
      setReply(null);
      setPhase("playing");
    }, 650);
    return () => clearTimeout(timer);
  }, [phase, reply]);

  function reset() {
    setGame(createPuzzleState(puzzle));
    setSelection(null);
    setPhase("playing");
    setTurnsPlayed(0);
    setFeedback("");
    setReply(null);
  }

  function commitTurn(next: GameState) {
    setGame(next);
    setSelection(null);
    const used = turnsPlayed + 1;
    setTurnsPlayed(used);
    if (getWinner(next) === puzzle.player) {
      setPhase("solved");
      setFeedback("Solved. You found the forced win.");
      return;
    }
    const remainingPlies = (puzzle.turns - used) * 2;
    if (isGameOver(next) || remainingPlies <= 0) {
      setPhase("failed");
      setFeedback("That turn falls short. Reset to try another idea.");
      return;
    }

    // Check every legal defence, not just the illustrated solution's reply.
    let defence: PuzzleTurn | null = null;
    const preferredKey = puzzle.line[1] ? puzzleMoveKey(puzzle.line[1]) : null;
    for (const turn of puzzleTurns(next)) {
      if (!canForcePuzzleWin(turn.state, puzzle.player, remainingPlies - 1)) {
        setPhase("failed");
        const opponent = puzzle.player === "white" ? "Black" : "White";
        setFeedback(
          getWinner(turn.state) === next.currentTurn
            ? `${opponent} can win with ${describePuzzleMove(turn.move)}. Reset to try again.`
            : `${opponent} can play ${describePuzzleMove(turn.move)} and prevent your win within ${puzzle.turns} turns.`,
        );
        return;
      }
      if (!defence || puzzleMoveKey(turn.move) === preferredKey) defence = turn;
    }
    if (!defence) {
      setPhase("failed");
      setFeedback("That position has no winning continuation within the turn limit.");
      return;
    }
    setReply(defence);
    setPhase("reply");
    setFeedback("Correct. Your opponent replies…");
  }

  function confirm() {
    if (phase !== "playing") return;
    const result = confirmPendingJump(game);
    if (result.ok) commitTurn(result.value);
  }

  function click(position: Position) {
    if (phase !== "playing") return;
    const forcedOrigin = getPendingJumpDestination(game);
    const origin = forcedOrigin ?? selection;
    if (forcedOrigin && arePositionsEqual(forcedOrigin, position)) {
      confirm();
      return;
    }
    if (origin) {
      if (getJumpTargets(game, origin).some((target) => arePositionsEqual(target, position))) {
        const result = jumpPiece(game, origin, position);
        if (result.ok) {
          setGame(result.value);
          setSelection(position);
          setFeedback("");
        }
        return;
      }
      if (forcedOrigin) return;
      // Never turn a missed jump target into an accidental placement.
      setSelection(
        game.positions[position.y]?.[position.x] === puzzle.player &&
          !arePositionsEqual(selection, position) &&
          getJumpTargets(game, position).length
          ? position
          : null,
      );
      return;
    }
    if (game.positions[position.y]?.[position.x] === puzzle.player) {
      if (getJumpTargets(game, position).length) setSelection(position);
      return;
    }
    const result = placePiece(game, position);
    if (result.ok) commitTurn(result.value);
    else setFeedback(result.reason);
  }

  function undoJump() {
    if (phase !== "playing") return;
    const result = undoPendingJumpStep(game);
    if (!result.ok) return;
    setGame(result.value);
    setSelection(getPendingJumpDestination(result.value));
    setFeedback("");
  }

  const lastMove =
    [...game.history].reverse().find((turn) => turn.type === "put" || turn.type === "jump") ?? null;
  return {
    game,
    selection,
    phase,
    turnsPlayed,
    feedback,
    lastMove,
    reset,
    confirm,
    click,
    undoJump,
    jumpTargets: selection ? getJumpTargets(game, selection) : [],
  };
}
