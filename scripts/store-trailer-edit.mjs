#!/usr/bin/env node
// Edit genuine UI recordings into the rules / friends / tournament trailer.
// node scripts/store-trailer-edit.mjs [capture-root]
// SHARP_MODULE may point to the bundled runtime's sharp package.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE || "sharp");
sharp.concurrency(1);
const root = resolve(process.argv[2] || "build/store-trailer-v2");
const edit = JSON.parse(readFileSync("scripts/assets/store-trailer/edit.json", "utf8"));
for (const dir of ["graphics", "cut"]) mkdirSync(resolve(root, dir), { recursive: true });
const ffmpeg = (args) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) throw Error(r.stderr || `ffmpeg exited ${r.status}`);
};
const esc = (t) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const sourceSvg = (file) => {
  const src = readFileSync(file, "utf8");
  return {
    viewBox: src.match(/viewBox="([^"]+)"/)[1],
    body: src.replace(/^.*?<svg[^>]*>/s, "").replace(/<\/svg>\s*$/, ""),
  };
};
const icon = sourceSvg("scripts/assets/tiao-icon.svg");
const name = sourceSvg("scripts/assets/tiao-wordmark.svg");
const brand = (x, y, w) =>
  `<svg x="${x}" y="${y}" width="${w * 0.23}" height="${w * 0.23}" viewBox="${icon.viewBox}">${icon.body}</svg><svg x="${x + w * 0.28}" y="${y + w * 0.015}" width="${w * 0.72}" height="${w * 0.21}" viewBox="${name.viewBox}">${name.body}</svg>`;
const colors = { ink: "#f9f2e2", dim: "#cdbda5", dark: "#201b16" };
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">${body}</svg>`;
for (const [i, shot] of edit.shots.entries()) {
  const n = String(i).padStart(2, "0");
  let overlay;
  if (shot.card) {
    const lines = Array.from(
      { length: 20 },
      (_, j) => `<path d="M${j * 100} 0V1080 M0 ${j * 100}H1920"/>`,
    ).join("");
    overlay = svg(
      `<rect width="1920" height="1080" fill="#f4eddd"/><g stroke="#705330" opacity=".09" stroke-width="1">${lines}</g>${brand(558, 320, 804)}<text x="960" y="648" text-anchor="middle" font-family="Georgia,serif" font-size="48" fill="#382a1d">${esc(shot.title)}</text><path d="M890 712H1030" stroke="#8eac69" stroke-width="3"/><text x="960" y="788" text-anchor="middle" font-family="Arial,sans-serif" font-size="29" fill="#765d44" letter-spacing="3">${esc(shot.sub || "")}</text>`,
    );
  } else {
    overlay = svg(
      `<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#201b16" stop-opacity="0"/><stop offset=".32" stop-color="#201b16" stop-opacity=".73"/><stop offset="1" stop-color="#201b16" stop-opacity=".97"/></linearGradient></defs><rect y="728" width="1920" height="352" fill="url(#shade)"/><text x="96" y="828" font-family="Arial,sans-serif" font-size="23" font-weight="600" letter-spacing="4" fill="#d2bd8f">${esc(shot.label || "TIAO")}</text><text x="92" y="922" font-family="Georgia,serif" font-size="${shot.size || 72}" fill="${colors.ink}">${esc(shot.title)}</text>${shot.sub ? `<text x="96" y="982" font-family="Arial,sans-serif" font-size="29" fill="${colors.dim}">${esc(shot.sub)}</text>` : ""}`,
    );
  }
  writeFileSync(resolve(root, "graphics", `${n}.svg`), overlay);
  await sharp(Buffer.from(overlay))
    .png()
    .toFile(resolve(root, "graphics", `${n}.png`));
  const args = ["-threads", "2"];
  if (shot.card)
    args.push("-loop", "1", "-framerate", "30", "-i", resolve(root, "graphics", `${n}.png`));
  else {
    if (shot.still) args.push("-loop", "1", "-framerate", "30");
    args.push("-i", resolve(root, "raw", shot.file));
    args.push("-loop", "1", "-framerate", "30", "-i", resolve(root, "graphics", `${n}.png`));
  }
  let filter;
  if (shot.card) filter = `[0:v]scale=1920:1080,format=yuv420p[v]`;
  else {
    const [x, y, w, h] = shot.crop || [0, 0, 1920, 1080];
    assert(x >= 0 && y >= 0 && x + w <= 1920 && y + h <= 1080, `Invalid crop for ${shot.file}`);
    const speed = shot.speed || 1;
    const frames = Math.round(shot.duration * 30);
    const time = shot.still
      ? ""
      : `trim=start=${shot.start || 0}:duration=${shot.duration * speed},setpts=(PTS-STARTPTS)/${speed},`;
    const camera = shot.detail
      ? "scale=1760:650:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(730-ih)/2:color=0xf4eddd"
      : shot.pan === false
        ? "scale=1920:1080:flags=lanczos"
        : `scale=1960:1104:flags=lanczos,crop=1920:1080:x='20+12*sin(t*.7)':y=12`;
    filter = `[0:v]${time}crop=${w}:${h}:${x}:${y},${camera},fps=30,tpad=stop_mode=clone:stop_duration=${shot.duration},trim=end_frame=${frames},setsar=1[base];[1:v]format=rgba,fade=t=in:st=0.08:d=0.22:alpha=1[caption];[base][caption]overlay=0:y='12*exp(-8*t)':shortest=1,format=yuv420p[v]`;
  }
  args.push(
    "-filter_complex_threads",
    "1",
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-an",
    "-t",
    String(shot.duration),
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-threads",
    "2",
    "-preset",
    "fast",
    "-b:v",
    "6M",
    "-minrate",
    "6M",
    "-maxrate",
    "6M",
    "-bufsize",
    "12M",
    "-x264-params",
    "nal-hrd=cbr:force-cfr=1",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    resolve(root, "cut", `${n}.mp4`),
  );
  ffmpeg(args);
  console.log(`Cut ${n}: ${shot.title} (${shot.duration}s)`);
}
const quote = (p) => "'" + p.replaceAll("'", "'\\''") + "'";
writeFileSync(
  resolve(root, "cut", "all.ffconcat"),
  "ffconcat version 1.0\n" +
    edit.shots
      .map((_, i) => `file ${quote(resolve(root, "cut", `${String(i).padStart(2, "0")}.mp4`))}`)
      .join("\n") +
    "\n",
);
ffmpeg([
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  resolve(root, "cut", "all.ffconcat"),
  "-c",
  "copy",
  resolve(root, "picture.mp4"),
]);
// Sound design uses the game's own move sound plus quiet, original sine accents.
const decoded = spawnSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-i",
    "client/public/move.mp3",
    "-f",
    "f32le",
    "-ac",
    "1",
    "-ar",
    "48000",
    "pipe:1",
  ],
  { maxBuffer: 16 * 1024 * 1024 },
);
assert.equal(decoded.status, 0);
const tap = new Float32Array(
  decoded.stdout.buffer,
  decoded.stdout.byteOffset,
  decoded.stdout.length / 4,
);
const duration = edit.shots.reduce((n, s) => n + s.duration, 0);
const samples = new Float32Array(Math.ceil(duration * 48000));
for (const event of edit.sounds) {
  const at = Math.round(event.time * 48000);
  if (event.type === "tap")
    for (let i = 0; i < tap.length && i + at < samples.length; i++)
      samples[at + i] += tap[i] * (event.gain || 0.45);
  else {
    const freq = event.frequency || 440;
    for (let i = 0; i < 48000 * 0.65 && at + i < samples.length; i++) {
      const t = i / 48000;
      samples[at + i] +=
        0.075 *
        Math.min(1, t / 0.004) *
        Math.exp(-t * 8) *
        (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * freq * 2 * t));
    }
  }
}
// Gentle peak limiter; no clipping, no music or voice needed to read the film.
for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh(samples[i]);
writeFileSync(resolve(root, "sound.f32"), Buffer.from(samples.buffer));
ffmpeg([
  "-f",
  "f32le",
  "-ar",
  "48000",
  "-ac",
  "1",
  "-i",
  resolve(root, "sound.f32"),
  "-af",
  "afade=t=out:st=" + (duration - 0.65) + ":d=0.65",
  "-c:a",
  "pcm_s16le",
  resolve(root, "sound.wav"),
]);
ffmpeg([
  "-i",
  resolve(root, "picture.mp4"),
  "-i",
  resolve(root, "sound.wav"),
  "-map",
  "0:v:0",
  "-map",
  "1:a:0",
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-t",
  String(duration),
  "-movflags",
  "+faststart",
  resolve(root, "tiao-rules-and-friends.mp4"),
]);
writeFileSync(
  resolve(root, "edit.json"),
  JSON.stringify(
    {
      ...edit,
      duration,
      width: 1920,
      height: 1080,
      fps: 30,
      audio: "Game move sound and original edit accents; no speech or music",
      approval: "Local review cut; not uploaded or approved",
    },
    null,
    2,
  ) + "\n",
);
console.log(`Rendered ${duration.toFixed(1)} seconds to ${root}/tiao-rules-and-friends.mp4`);
