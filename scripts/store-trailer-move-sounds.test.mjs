import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectMoveSounds } from "./store-trailer-move-sounds.mjs";

const edit = JSON.parse(readFileSync("scripts/assets/store-trailer/edit.json", "utf8"));
const manifest = JSON.parse(readFileSync(edit.moveSounds.file, "utf8"));

test("move sounds cover the real replay and Black double capture, with UI shots silent", () => {
  const cues = projectMoveSounds(edit, manifest);
  assert.equal(cues.length, 74);
  const counter = cues.filter((c) => c.sourceFile === "counter.webm");
  assert.deepEqual(
    counter.map((c) => c.action),
    ["jump", "jump", "confirm"],
  );
  assert(
    counter.every(
      (c) =>
        manifest.sources
          .find((s) => s.file === c.sourceFile)
          .events.find((e) => e.id === c.actionId).color === "black",
    ),
  );
  assert(!cues.some((c) => c.time >= 12.5 && c.time < 31.2));
  assert(!cues.some((c) => c.time >= 46.8));
  assert(!edit.shots.some((s) => s.title?.toLowerCase().includes("chain")));
});

test("every AI action survives the continuous, progressively faster ending", () => {
  const cues = projectMoveSounds(edit, manifest).filter((c) => c.time >= 31.2);
  const source = manifest.sources.find((s) => s.file === "ai-match.webm");
  assert.equal(cues.length, source.events.length);
  assert.equal(new Set(cues.map((c) => c.actionId)).size, 63);
  const shots = edit.shots.filter((s) => s.name?.includes("accelerating full match"));
  assert.equal(shots.length, 6);
  for (let i = 1; i < shots.length; i++) {
    assert(
      Math.abs(shots[i - 1].start + shots[i - 1].duration * shots[i - 1].speed - shots[i].start) <
        1e-8,
    );
    assert(shots[i].speed > shots[i - 1].speed);
  }
  for (const shot of shots) {
    assert.equal(shot.framing, "native");
    assert.deepEqual(shot.crop, [0, 0, 1920, 1080]);
  }
  assert(edit.sounds.length <= 5);
  assert(edit.transition.targetPeakDb <= -14);
  assert.equal(edit.shots[0].kind, "brand");
  assert(edit.shots.every((s) => !s.label && !s.sub));
});

test("source events follow shot trims and speed changes, including repeated footage", () => {
  const sample = {
    fps: 30,
    sounds: [],
    moveSounds: { gain: 0.5 },
    shots: [
      { kind: "footage", file: "source.webm", start: 2, speed: 2, duration: 1, timelineStart: 10 },
      { kind: "footage", file: "source.webm", start: 2, speed: 1, duration: 1, timelineStart: 20 },
      {
        kind: "footage",
        file: "source.webm",
        start: 2,
        speed: 1,
        duration: 1,
        timelineStart: 30,
        moveSounds: false,
      },
    ],
  };
  const events = {
    sources: [
      {
        file: "source.webm",
        fps: 30,
        events: [
          { id: "trimmed", frame: 59, kind: "place" },
          { id: "move", frame: 75, kind: "jump" },
          { id: "end-boundary", frame: 120, kind: "confirm" },
        ],
      },
    ],
  };
  assert.deepEqual(
    projectMoveSounds(sample, events).map((cue) => cue.frame),
    [308, 615],
  );
});

test("uncorrelated global taps and preview events cannot enter the move track", () => {
  assert.throws(() =>
    projectMoveSounds({ ...edit, sounds: [{ type: "tap", time: 9.4 }] }, manifest),
  );
  const invalid = structuredClone(manifest);
  invalid.sources.find((source) => source.file === "ai-match.webm").events[0].kind = "hover";
  assert.throws(() => projectMoveSounds(edit, invalid));
});

test("moves outside the shot crop stay silent", () => {
  const hidden = structuredClone(edit);
  for (const shot of hidden.shots) if (shot.kind === "footage") shot.crop = [0, 0, 100, 100];
  assert.deepEqual(projectMoveSounds(hidden, manifest), []);
});

test("opening placements build separated pairs with no immediate captures", async () => {
  const { createInitialGameState, placePiece, getJumpTargets, findConnectedCluster } = await import(
    "../shared/src/tiao.ts"
  );
  const positions = JSON.parse(readFileSync("scripts/assets/store-trailer/ai-match.json", "utf8"))
    .moves.slice(0, 4)
    .map((move) => move.position);
  let state = createInitialGameState();
  for (const position of positions) {
    const result = placePiece(state, position);
    assert(result.ok);
    state = result.value;
    for (let y = 0; y < state.boardSize; y++)
      for (let x = 0; x < state.boardSize; x++)
        if (state.positions[y][x]) assert.equal(getJumpTargets(state, { x, y }).length, 0);
  }
  assert.equal(findConnectedCluster(state, positions[0]).length, 2);
  assert.equal(findConnectedCluster(state, positions[1]).length, 2);
});

test("theme cuts retain the full native square board", () => {
  const themes = edit.shots.filter(
    (s) => s.name?.endsWith("board") && s.file.startsWith("ai-theme-"),
  );
  assert.equal(themes.length, 4);
  for (const shot of themes) {
    assert.equal(shot.framing, "native");
    assert.deepEqual(shot.crop, [0, 0, 1920, 1080]);
    assert(shot.still);
  }
  assert(edit.shots.some((s) => s.title === "Play with friends."));
  assert(edit.shots.some((s) => s.title === "Win tournaments."));
});
