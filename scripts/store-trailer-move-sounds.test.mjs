import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectMoveSounds, sourceToTimeline } from "./store-trailer-move-sounds.mjs";

const edit = JSON.parse(readFileSync("scripts/assets/store-trailer/edit.json", "utf8"));
const manifest = JSON.parse(readFileSync(edit.moveSounds.file, "utf8"));

test("committed cues cover both rule colors, the real teaser and complete AI win", () => {
  const cues = projectMoveSounds(edit, manifest);
  assert.equal(cues.length, 77);
  const counter = cues.filter((c) => c.sourceFile === "counter-hq");
  assert.deepEqual(
    counter.map((c) => c.action),
    ["jump", "confirm", "jump", "jump", "confirm"],
  );
  const source = manifest.sources.find((s) => s.file === "counter-hq");
  assert.deepEqual(
    counter.map((c) => source.events.find((e) => e.id === c.actionId).color),
    ["white", "white", "black", "black", "black"],
  );
  const rulesEnd = edit.shots[6].timelineStart;
  const finaleStart = edit.shots.find((shot) => shot.acceleration).timelineStart;
  assert(!cues.some((c) => c.time >= rulesEnd && c.time < finaleStart));
  assert(!cues.some((c) => c.time > edit.music.resolveAt));
});

test("continuous acceleration never slows and the final confirmation hits the piano cadence", () => {
  const source = manifest.sources.find((s) => s.file === "ai-hq");
  const finaleStart = edit.shots.find((shot) => shot.acceleration).timelineStart;
  const cues = projectMoveSounds(edit, manifest).filter((c) => c.time >= finaleStart);
  assert.equal(cues.length, source.events.length);
  assert.equal(new Set(cues.map((c) => c.actionId)).size, 63);
  const shot = edit.shots.find((s) => s.acceleration);
  const steps = source.events.slice(0, -1).map((e) => sourceToTimeline(shot, e.frame / source.fps));
  const gaps = steps.slice(1).map((v, i) => v - steps[i]);
  for (let i = 1; i < gaps.length; i++) assert(gaps[i] < gaps[i - 1]);
  assert.equal(cues.at(-1).time, edit.music.resolveAt);
  assert.equal(cues.at(-1).action, "confirm");
  const win = edit.shots.find((s) => s.name?.includes("native confetti"));
  assert.equal(win.timelineStart, edit.music.resolveAt);
  assert.equal(
    source.events.at(-1).frame / source.fps,
    shot.start + shot.acceleration.sourceDuration,
  );
  const victory = manifest.sources.find((s) => s.file === win.file);
  assert.equal(victory.events[0].id, source.events.at(-1).id);
  assert.equal(win.start, victory.events[0].frame / victory.fps);
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
  invalid.sources.find((source) => source.file === "ai-hq").events[0].kind = "hover";
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
