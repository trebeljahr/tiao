#!/usr/bin/env node
// Render clean UI footage separated by full-screen title cards, with a music bed.
// SHARP_MODULE may point to a separately installed Sharp package.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { projectMoveSounds } from "./store-trailer-move-sounds.mjs";

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE || "sharp");
sharp.concurrency(1);
const root = resolve(
  process.argv.slice(2).find((a) => !a.startsWith("--")) || "build/store-trailer-v9",
);
const editPath =
  process.argv.find((a) => a.startsWith("--edit="))?.slice(7) ||
  "scripts/assets/store-trailer/edit.json";
const edit = JSON.parse(readFileSync(editPath, "utf8"));
const moveManifest = edit.moveSounds
  ? JSON.parse(readFileSync(edit.moveSounds.file, "utf8"))
  : null;
const moveCues = moveManifest ? projectMoveSounds(edit, moveManifest) : [];
const sounds = [...edit.sounds, ...moveCues].sort((a, b) => a.time - b.time);
const audioOnly = process.argv.includes("--audio-only");
const outputName = edit.outputName || "tiao-ai-match.mp4";
const selectedShot = process.argv.find((a) => a.startsWith("--shot="))?.slice(7);
for (const source of moveManifest?.sources || []) {
  const file = resolve(root, "raw", source.file);
  if (existsSync(file))
    assert.equal(
      createHash("sha256").update(readFileSync(file)).digest("hex"),
      source.sha256,
      "Move timing belongs to a different recording: " + source.file,
    );
}
for (const dir of ["graphics", "cut", "audio"]) mkdirSync(resolve(root, dir), { recursive: true });
const run = (args, options = {}) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  assert.equal(r.status, 0, r.stderr?.toString() || "FFmpeg failed");
  return r;
};
const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">${body}</svg>`;
const sourceSvg = (file) => {
  const text = readFileSync(file, "utf8");
  return {
    viewBox: text.match(/viewBox="([^"]+)"/)[1],
    body: text.replace(/^.*?<svg[^>]*>/s, "").replace(/<\/svg>\s*$/, ""),
  };
};
const icon = sourceSvg("scripts/assets/tiao-icon.svg"),
  wordmark = sourceSvg("scripts/assets/tiao-wordmark.svg");
const brand = `<svg x="558" y="440" width="185" height="185" viewBox="${icon.viewBox}">${icon.body}</svg><svg x="783" y="452" width="579" height="169" viewBox="${wordmark.viewBox}" fill="#f4ede1" color="#f4ede1">${wordmark.body}</svg>`;
const cardSvg = (shot) => {
  const { intertitleBackground: background, ink } = edit.style;
  if (shot.kind === "brand")
    return svg(`<rect width="1920" height="1080" fill="${background}"/>${brand}`);
  const lines = shot.title.split("\n");
  const top = lines.length === 1 ? 578 : 514;
  return svg(
    `<rect width="1920" height="1080" fill="${background}"/>${lines.map((line, i) => `<text x="960" y="${top + i * 126}" text-anchor="middle" font-family="Georgia,serif" font-size="112" fill="${ink}">${esc(line)}</text>`).join("")}`,
  );
};
const encoder = [
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
];
if (!audioOnly) {
  for (const [i, shot] of edit.shots.entries()) {
    if (selectedShot !== undefined && i !== Number(selectedShot)) continue;
    const id = String(i).padStart(2, "0"),
      frames = Math.round(shot.duration * 30);
    const args = ["-threads", "2"];
    let filter;
    if (shot.kind !== "footage") {
      const art = cardSvg(shot);
      writeFileSync(resolve(root, "graphics", `${id}.svg`), art);
      await sharp(Buffer.from(art))
        .png()
        .toFile(resolve(root, "graphics", `${id}.png`));
      args.push("-loop", "1", "-framerate", "30", "-i", resolve(root, "graphics", `${id}.png`));
      const fadeOut = shot.end ? 0.5 : edit.style.fadeOut;
      filter = `scale=1920:1080,fade=t=in:st=0:d=${edit.style.fadeIn},fade=t=out:st=${shot.duration - fadeOut}:d=${fadeOut},setsar=1`;
    } else {
      if (shot.still) args.push("-loop", "1", "-framerate", "30");
      args.push("-i", resolve(root, "raw", shot.file));
      const [x, y, w, h] = shot.crop || [0, 0, 1920, 1080];
      assert(x >= 0 && y >= 0 && x + w <= 1920 && y + h <= 1080, `Invalid crop ${shot.file}`);
      const speed = shot.speed || 1;
      const time = shot.still
        ? ""
        : `trim=start=${shot.start || 0}:duration=${shot.duration * speed},setpts=(PTS-STARTPTS)/${speed},`;
      const camera =
        shot.framing === "native"
          ? "scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf4eddd"
          : shot.detail
            ? "scale=1760:850:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf4eddd"
            : "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080";
      filter = `${time}crop=${w}:${h}:${x}:${y},${camera},fps=30,tpad=stop_mode=clone:stop_duration=${shot.duration},trim=end_frame=${frames},setsar=1`;
      if (edit.shots[i + 1]?.kind !== "footage")
        filter += `,fade=t=out:st=${shot.duration - edit.style.fadeOut}:d=${edit.style.fadeOut}`;
    }
    run([
      ...args,
      "-vf",
      filter,
      "-filter_threads",
      "1",
      "-an",
      "-t",
      String(shot.duration),
      "-r",
      "30",
      ...encoder,
      resolve(root, "cut", `${id}.mp4`),
    ]);
    console.log(`Shot ${id}: ${shot.kind} / ${shot.title?.replaceAll("\n", " ") || shot.name}`);
  }
  const quote = (p) => "'" + p.replaceAll("'", "'\\''") + "'";
  writeFileSync(
    resolve(root, "cut", "all.ffconcat"),
    "ffconcat version 1.0\n" +
      edit.shots
        .map((_, i) => `file ${quote(resolve(root, "cut", String(i).padStart(2, "0") + ".mp4"))}`)
        .join("\n") +
      "\n",
  );
  run([
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
}
const duration = Number(edit.shots.reduce((n, s) => n + s.duration, 0).toFixed(4));
const measure = (file) => {
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  assert.equal(r.status, 0, r.stderr);
  const integrated = [...r.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1);
  const peak = [...r.stderr.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].at(-1);
  assert(integrated && peak, "Loudness measurement missing");
  return { integratedLufs: Number(integrated[1]), truePeakDbfs: Number(peak[1]) };
};
// One continuous music excerpt, at its original tempo and pitch.
run([
  "-ss",
  String(edit.music.in),
  "-i",
  edit.music.file,
  "-t",
  String(duration),
  "-af",
  `aresample=48000,afade=t=in:st=0:d=${edit.music.fadeIn},afade=t=out:st=${duration - edit.music.fadeOut}:d=${edit.music.fadeOut}`,
  "-ac",
  "2",
  "-c:a",
  "pcm_s24le",
  resolve(root, "audio", "music-source.wav"),
]);
const beforeMusic = measure(resolve(root, "audio", "music-source.wav"));
const musicGain = edit.music.targetLufs - beforeMusic.integratedLufs;
run([
  "-i",
  resolve(root, "audio", "music-source.wav"),
  "-af",
  `volume=${musicGain}dB,alimiter=limit=0.79:attack=5:release=80:level=false`,
  "-c:a",
  "pcm_s24le",
  resolve(root, "audio", "music.wav"),
]);
const decode = (file, seconds) => {
  const args = ["-i", file];
  if (seconds) args.push("-t", String(seconds));
  const r = run([...args, "-f", "f32le", "-ac", "2", "-ar", "48000", "pipe:1"]);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
};
const samples = new Float32Array(Math.ceil(duration * 48000) * 2);
const music = decode(resolve(root, "audio", "music.wav"));
assert(music.length >= samples.length - 960, "Music bed is shorter than the cut");
const effects = new Float32Array(samples.length);
const moves = new Float32Array(samples.length);
const transitions = new Float32Array(samples.length);
const duckedMusic = new Float32Array(samples.length);
const taps = decode("client/public/move.mp3");
const whoosh = decode(edit.transition.file, edit.transition.duration);
const hit = decode(edit.endHit.file, edit.endHit.duration);
const peak = (stem) => stem.reduce((n, v) => Math.max(n, Math.abs(v)), 0);
const duckEvents = sounds.filter((e) => e.type !== "tap");
for (let i = 0; i < samples.length; i += 2) {
  const time = i / 96000;
  let duckDb = 0;
  for (const event of duckEvents) {
    const delta = time - event.time;
    const envelope =
      delta < -0.25 || delta > 0.7
        ? 0
        : delta < -0.08
          ? (delta + 0.25) / 0.17
          : delta < 0.18
            ? 1
            : (0.7 - delta) / 0.52;
    duckDb = Math.min(duckDb, -edit.transition.duckDb * envelope);
  }
  const gain = 10 ** (duckDb / 20);
  duckedMusic[i] = (music[i] || 0) * gain;
  duckedMusic[i + 1] = (music[i + 1] || 0) * gain;
}
for (const event of sounds) {
  const isTap = event.type === "tap";
  const stem = isTap ? taps : event.type === "whoosh" ? whoosh : hit;
  const settings = isTap ? null : event.type === "whoosh" ? edit.transition : edit.endHit;
  const at = Math.round((event.time - (settings?.peakOffset || 0)) * 48000) * 2;
  // Normalize each effect by its own peak. Raw source gains are not comparable.
  const gain = isTap
    ? event.gain || 0.45
    : 10 ** ((event.targetPeakDb ?? settings.targetPeakDb) / 20) / peak(stem);
  for (let i = 0; i < stem.length; i++) {
    const target = at + i;
    if (target < 0 || target >= samples.length) continue;
    const remain = (stem.length - i) / 96000;
    const fade = settings ? Math.min(1, remain / settings.fadeOut) : 1;
    effects[target] += stem[i] * gain * fade;
    if (isTap) moves[target] += stem[i] * gain * fade;
    else transitions[target] += stem[i] * gain * fade;
  }
}
for (let i = 0; i < samples.length; i++) samples[i] = duckedMusic[i] + effects[i];
const windowRms = (stem, time) => {
  const begin = Math.max(0, Math.floor((time - 0.12) * 96000));
  const end = Math.min(stem.length, Math.ceil((time + 0.22) * 96000));
  let sum = 0;
  for (let i = begin; i < end; i++) sum += stem[i] ** 2;
  return 10 * Math.log10(Math.max(1e-12, sum / (end - begin)));
};
const musicContinuity = Array.from({ length: Math.floor(duration) - 1 }, (_, time) => ({
  time: time + 0.5,
  rmsDb: windowRms(music, time + 0.5),
}));
assert(
  musicContinuity.every((window) => window.rmsDb > -60),
  "Unexpected silence in the music bed",
);
const cueReport = duckEvents.map((event) => ({
  type: event.type,
  time: event.time,
  effectRmsDb: windowRms(transitions, event.time),
  duckedMusicRmsDb: windowRms(duckedMusic, event.time),
  effectAboveMusicDb: windowRms(transitions, event.time) - windowRms(duckedMusic, event.time),
}));
// Transitions are accents beneath the piano; never force them above the music.
for (const [name, stem] of [
  ["effects", effects],
  ["moves", moves],
  ["transitions", transitions],
  ["music-ducked", duckedMusic],
]) {
  writeFileSync(resolve(root, "audio", name + ".f32"), Buffer.from(stem.buffer));
  run([
    "-f",
    "f32le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-i",
    resolve(root, "audio", name + ".f32"),
    "-c:a",
    "pcm_s24le",
    resolve(root, "audio", name + ".wav"),
  ]);
}
writeFileSync(resolve(root, "audio", "mix.f32"), Buffer.from(samples.buffer));
run([
  "-f",
  "f32le",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-i",
  resolve(root, "audio", "mix.f32"),
  "-af",
  `afade=t=out:st=${duration - 0.4}:d=0.4`,
  "-c:a",
  "pcm_s24le",
  resolve(root, "audio", "mix.wav"),
]);
const beforeMaster = measure(resolve(root, "audio", "mix.wav"));
const masterGain = Math.min(-16 - beforeMaster.integratedLufs, -2 - beforeMaster.truePeakDbfs);
run([
  "-i",
  resolve(root, "audio", "mix.wav"),
  "-af",
  `volume=${masterGain}dB,alimiter=limit=0.79:attack=5:release=80:level=false`,
  "-c:a",
  "pcm_s24le",
  resolve(root, "audio", "master.wav"),
]);
run([
  "-i",
  resolve(root, "picture.mp4"),
  "-i",
  resolve(root, "audio", "master.wav"),
  "-map",
  "0:v:0",
  "-map",
  "1:a:0",
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-b:a",
  "256k",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-t",
  String(duration),
  "-movflags",
  "+faststart",
  resolve(root, outputName),
]);
const measured = measure(resolve(root, outputName));
const audioReport = {
  moveCues,
  musicSource: edit.music,
  beforeMusic,
  musicGainDb: musicGain,
  beforeMaster,
  masterGainDb: masterGain,
  measured,
  cues: cueReport,
  musicContinuity,
};
writeFileSync(
  resolve(root, "audio", "mix-report.json"),
  JSON.stringify(audioReport, null, 2) + "\n",
);
writeFileSync(
  resolve(root, "edit.json"),
  JSON.stringify(
    {
      ...edit,
      resolvedMoveSounds: moveCues,
      duration,
      width: 1920,
      height: 1080,
      fps: 30,
      audio: edit.audioDescription,
      approval: "Local review cut; not uploaded or approved",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    duration,
    shots: edit.shots.length,
    audio: measured,
    output: resolve(root, outputName),
  }),
);
