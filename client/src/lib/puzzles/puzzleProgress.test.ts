import { describe, expect, it } from "vitest";
import { nextPuzzle, readPuzzleProgress } from "./puzzleProgress";

const ids = ["one", "two", "three"];
describe("puzzle progress", () => {
  it("recovers from broken and outdated saved data", () => {
    expect(readPuzzleProgress("{", ids).currentId).toBe("one");
    expect(readPuzzleProgress("null", ids).currentId).toBe("one");
    expect(
      readPuzzleProgress(
        JSON.stringify({ currentId: "gone", solved: ["two", "two", "gone", 3], seen: "bad" }),
        ids,
      ),
    ).toEqual({ currentId: "one", solved: ["two"], seen: [] });
  });
  it("resumes the current puzzle and keeps solved puzzles", () => {
    const saved = { currentId: "two", solved: ["one"], seen: ["one", "two"] };
    expect(readPuzzleProgress(JSON.stringify(saved), ids)).toEqual(saved);
    expect(nextPuzzle(ids, saved)).toEqual({ ...saved, currentId: "three", seen: ids });
  });
  it("shuffles through unseen puzzles before starting another cycle", () => {
    let progress = readPuzzleProgress(null, ids);
    progress = nextPuzzle(ids, progress, () => 0.99);
    expect(progress.currentId).toBe("three");
    progress = nextPuzzle(ids, progress, () => 0.99);
    expect(progress.currentId).toBe("two");
    const next = nextPuzzle(ids, progress, () => 0);
    expect(next.currentId).not.toBe("two");
    expect(next.seen).toEqual([next.currentId]);
  });
  it("handles a filtered pool with one or no choices", () => {
    const progress = readPuzzleProgress(null, ids);
    expect(nextPuzzle([], progress)).toBe(progress);
    expect(nextPuzzle(["two"], progress).currentId).toBe("two");
  });
});
