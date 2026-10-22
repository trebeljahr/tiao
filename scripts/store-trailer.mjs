#!/usr/bin/env node
// Encode CUA screenshots of the real replay UI. Capture bytes and timestamps
// live beside capture.json; pauses between takes are cut, then playback is 1.75x.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(new URL("../client/package.json", import.meta.url));
const sharp = require("sharp");
sharp.concurrency(1);
const root = resolve(process.argv[2] || "build/store-trailer");
const capture = JSON.parse(readFileSync(resolve(root, "capture.json"), "utf8"));
const speed = 1.75;
const duration = 30;
let elapsed = 0;
const timeline = capture.frames.map((frame, i, frames) => {
  const start = elapsed;
  const next = frames[i + 1];
  const ms = next && !capture.takeStarts.includes(i + 1) ? next.elapsedMs - frame.elapsedMs : 40;
  elapsed += ms / 1000;
  return { ...frame, start: start / speed, duration: ms / 1000 };
});
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
writeFileSync(
  resolve(root, "frames.ffconcat"),
  "ffconcat version 1.0\n" +
    timeline
      .map(
        (f) => `file ${quote(resolve(root, "capture", f.file))}\nduration ${f.duration.toFixed(6)}`,
      )
      .join("\n") +
    `\nfile ${quote(resolve(root, "capture", timeline.at(-1).file))}\n`,
);
const atMove = (move) => timeline.find((f) => f.move === move).start;
const captions = [
  { start: 0, end: atMove(15), text: "Place a stone on an empty point." },
  { start: atMove(15), end: atMove(19), text: "Jump an opponent’s stone to capture it." },
  { start: atMove(19), end: atMove(41), text: "Chain jumps to capture several stones." },
  { start: atMove(41), end: duration, text: "First to capture ten stones wins." },
];
for (const [i, caption] of captions.entries()) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="106"><rect width="1920" height="106" fill="#f4eddd"/><text x="46" y="51" font-family="Georgia,serif" font-size="40" fill="#28170e">${caption.text}</text><text x="48" y="87" font-family="Arial,sans-serif" font-size="20" fill="#705330">Recorded in Tiao · game replay at 1.75× speed · no audio</text></svg>`;
  writeFileSync(resolve(root, `caption-${i}.svg`), svg);
  await sharp(Buffer.from(svg))
    .png()
    .toFile(resolve(root, `caption-${i}.png`));
}
const args = [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-threads",
  "2",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  resolve(root, "frames.ffconcat"),
];
for (let i = 0; i < captions.length; i++)
  args.push("-loop", "1", "-i", resolve(root, `caption-${i}.png`));
const filters = [
  `[0:v]setpts=PTS/${speed},scale=1920:974:flags=lanczos,pad=1920:1080:0:0:color=0xf4eddd,fps=30,tpad=stop_mode=clone:stop_duration=4[v0]`,
];
for (const [i, c] of captions.entries())
  filters.push(
    `[v${i}][${i + 1}:v]overlay=0:974:enable='gte(t,${c.start})*lt(t,${c.end})'[v${i + 1}]`,
  );
args.push(
  "-filter_complex_threads",
  "1",
  "-filter_complex",
  filters.join(";"),
  "-map",
  `[v${captions.length}]`,
  "-an",
  "-c:v",
  "libx264",
  "-threads",
  "2",
  "-preset",
  "fast",
  "-crf",
  "18",
  "-pix_fmt",
  "yuv420p",
  "-t",
  String(duration),
  "-movflags",
  "+faststart",
  resolve(root, "tiao-gameplay-current.mp4"),
);
const result = spawnSync("ffmpeg", args, { stdio: "inherit" });
if (result.status !== 0) throw new Error(`ffmpeg exited with ${result.status}`);
writeFileSync(
  resolve(root, "edit.json"),
  JSON.stringify(
    {
      source: capture.url,
      speed,
      duration,
      captureCount: timeline.length,
      takeStarts: capture.takeStarts,
      captions,
      audio: false,
      output: "tiao-gameplay-current.mp4",
      approval: "local candidate; not uploaded or approved",
      note: "Actual replay UI screenshots. Pauses between three capture takes removed. Final frame held through 30 seconds.",
    },
    null,
    2,
  ) + "\n",
);
console.log(`Encoded ${timeline.length} captured frames to ${root}/tiao-gameplay-current.mp4`);
