export type PuzzleProgress = { currentId: string; solved: string[]; seen: string[] };
export const PUZZLE_PROGRESS_KEY = "tiao-puzzle-progress-v1";

export function readPuzzleProgress(raw: string | null, ids: string[]): PuzzleProgress {
  const initial = { currentId: ids[0], solved: [], seen: [ids[0]] };
  if (!raw) return initial;
  try {
    const saved = JSON.parse(raw);
    const valid = (values: unknown): string[] =>
      Array.isArray(values)
        ? [
            ...new Set(
              values.filter((id): id is string => typeof id === "string" && ids.includes(id)),
            ),
          ]
        : [];
    return {
      currentId: ids.includes(saved.currentId) ? saved.currentId : ids[0],
      solved: valid(saved.solved),
      seen: valid(saved.seen),
    };
  } catch {
    return initial;
  }
}

/** Exhaust the current selection before repeating; never immediately repeat when alternatives exist. */
export function nextPuzzle(
  ids: string[],
  progress: PuzzleProgress,
  random?: () => number,
): PuzzleProgress {
  if (!ids.length) return progress;
  const start = Math.max(0, ids.indexOf(progress.currentId));
  const ordered = [...ids.slice(start + 1), ...ids.slice(0, start + 1)];
  let candidates = ordered.filter((id) => !progress.seen.includes(id) && id !== progress.currentId);
  const exhausted = candidates.length === 0;
  if (exhausted) candidates = ordered.filter((id) => id !== progress.currentId);
  const currentId = candidates.length
    ? candidates[
        random ? Math.min(candidates.length - 1, Math.floor(random() * candidates.length)) : 0
      ]
    : ids[0];
  return { ...progress, currentId, seen: exhausted ? [currentId] : [...progress.seen, currentId] };
}
