import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectMoveSounds } from "./store-trailer-move-sounds.mjs";

const edit = JSON.parse(readFileSync("scripts/assets/store-trailer/edit.json", "utf8"));
const manifest = JSON.parse(readFileSync(edit.moveSounds.file, "utf8"));

test("recorded jump clicks occur at moves, with hover and pause ranges silent", () => {
  const cues = projectMoveSounds(edit, manifest);
  assert.equal(cues.length, 29);
  assert.deepEqual(
    cues.filter((cue) => cue.shotIndex === 5).map((cue) => cue.frame),
    [324, 356],
  );
  assert(!cues.some((cue) => cue.time >= 9.2 && cue.time < 10.8));
  assert(!cues.some((cue) => cue.time >= 18.5 && cue.time < 38.7));
  assert(!cues.some((cue) => cue.time >= 46.9));
  assert.equal(cues.filter((cue) => cue.action === "place").length, 8);
});

test("the final legal exchange retains every visible placement, jump and capture", () => {
  const cues = projectMoveSounds(edit, manifest).filter(
    (c) => c.sourceFile === "finale-continuous.webm",
  );
  assert.equal(cues.length, 13);
  assert.equal(cues.filter((c) => c.action === "confirm").length, 2);
  assert.equal(cues.filter((c) => c.action === "jump").length, 7);
  assert.equal(cues.filter((c) => c.action === "place").length, 4);
  assert.deepEqual(
    cues.map((c) => c.sourceFrame),
    [22, 43, 64, 83, 111, 129, 144, 153, 183, 200, 215, 230, 237],
  );
  const shots = edit.shots.filter((s) => s.file === "finale-continuous.webm");
  assert.equal(shots[0].start + shots[0].duration * shots[0].speed, shots[1].start);
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
  invalid.sources.find((source) => source.file === "chain.webm").events[0].kind = "hover";
  assert.throws(() => projectMoveSounds(edit, invalid));
});

test("moves outside the shot crop stay silent", () => {
  const hidden = structuredClone(edit);
  for (const shot of hidden.shots) if (shot.kind === "footage") shot.crop = [0, 0, 100, 100];
  assert.deepEqual(projectMoveSounds(hidden, manifest), []);
});
