#!/usr/bin/env node
// Fingerprint every lossless source frame and associate only committed UI moves.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || "build/store-trailer-v10");
const sources = [];
for (const [name, eventsFile, prepare, count] of [
  ["ai-hq", "ai-hq-events.json", "prepare-ai-0.log", 1224],
  ["counter-hq", "counter-hq-events.json", "prepare-counter-real-0.log", 144],
]) {
  const directory = resolve(root, "raw", name);
  const frames = readdirSync(directory)
    .filter((x) => /^f\d{6}\.png$/.test(x))
    .sort()
    .map((file, index) => {
      assert.equal(file, `f${String(index).padStart(6, "0")}.png`, "A source frame is missing");
      return {
        file,
        sha256: createHash("sha256")
          .update(readFileSync(resolve(directory, file)))
          .digest("hex"),
      };
    });
  assert.equal(frames.length, count);
  const text = readFileSync(resolve(root, prepare), "utf8");
  const grid = JSON.parse(text.split("### Result\n")[1].split("\n###")[0]);
  const events = JSON.parse(readFileSync(resolve(root, eventsFile), "utf8"));
  sources.push({
    file: name,
    fps: 30,
    sourceSize: [3840, 2160],
    sha256: createHash("sha256").update(JSON.stringify(frames)).digest("hex"),
    frames,
    grid,
    events,
  });
}
const victory = JSON.parse(readFileSync(resolve(root, "victory-source.json"), "utf8"));
assert.equal(
  createHash("sha256")
    .update(readFileSync(resolve(root, "raw", victory.file)))
    .digest("hex"),
  victory.sha256,
);
sources.push(victory);
const manifest = {
  method:
    "Lossless 2× actual-UI screenshots, encoded at 30 fps. AI uses stepped browser time; the rule demo uses a fresh normal-clock context. AI decisions use the complete genuine Intermediate/Hard ledger. Committed actions are scheduled every 18 source frames; selection/hover previews carry no cues. Encoded pixels are audited independently.",
  sources,
};
const output = process.argv[3] || "scripts/assets/store-trailer/move-events.json";
writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({
    sources: sources.map((s) => ({
      file: s.file,
      frames: s.frames?.length,
      events: s.events.length,
      sha256: s.sha256,
    })),
    output,
  }),
);
