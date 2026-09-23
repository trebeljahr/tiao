import { readFile } from "node:fs/promises";
import { createLogger } from "../lib/logger";
import type { PuzzleOfTheWeek, PuzzleSide } from "./commands";

const log = createLogger("discord");

/**
 * Puzzle of the Week lives in a small JSON file so it can be swapped by
 * editing one file on the server without a deploy or an admin UI.
 *
 * Expected shape (see server/.env.example for the path variable):
 *   {
 *     "title": "Puzzle #12",            // optional
 *     "weekOf": "2026-09-21",           // optional
 *     "position": "White: a1, b2 ...", // free-form text or notation
 *     "sideToMove": "white",           // "white" | "black"
 *     "difficulty": "medium",
 *     "imageUrl": "https://assets.example.com/puzzles/12.png"
 *   }
 *
 * The file is read on every /puzzle call — it's tiny, and re-reading
 * means edits show up immediately.
 */

const SIDES: PuzzleSide[] = ["white", "black"];

export function parsePuzzle(raw: unknown): PuzzleOfTheWeek | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const position = typeof record.position === "string" ? record.position.trim() : "";
  const sideToMove = record.sideToMove;
  const difficulty = typeof record.difficulty === "string" ? record.difficulty.trim() : "";
  const imageUrl = typeof record.imageUrl === "string" ? record.imageUrl.trim() : "";

  if (!position || !difficulty || !imageUrl) return null;
  if (typeof sideToMove !== "string" || !SIDES.includes(sideToMove as PuzzleSide)) return null;

  const puzzle: PuzzleOfTheWeek = {
    position,
    sideToMove: sideToMove as PuzzleSide,
    difficulty,
    imageUrl,
  };
  if (typeof record.title === "string" && record.title.trim()) puzzle.title = record.title.trim();
  if (typeof record.weekOf === "string" && record.weekOf.trim()) {
    puzzle.weekOf = record.weekOf.trim();
  }
  return puzzle;
}

/**
 * Load the puzzle from `filePath`. Missing file, unreadable JSON or an
 * incomplete record all resolve to `null` so the command can answer with
 * a friendly "nothing configured" message instead of erroring.
 */
export async function loadPuzzleFromFile(
  filePath: string | undefined,
): Promise<PuzzleOfTheWeek | null> {
  if (!filePath) return null;
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch {
    return null;
  }
  try {
    return parsePuzzle(JSON.parse(contents));
  } catch {
    log.warn("puzzle file is not valid JSON; ignoring", { filePath });
    return null;
  }
}
