#!/usr/bin/env node
// Original short piano composition, written as explicit MIDI events.
// Deterministic timing/velocity variation preserves a reproducible performance.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || "build/store-trailer-v5");
mkdirSync(root, { recursive: true });
const beat = 48.2 / 80;
const events = [];
const notes = [];
let seed = 231026;
const random = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 4294967296;
};
const note = (part, midi, b, length, velocity) => {
  const time = Math.max(0, b * beat + (random() - 0.5) * 0.014);
  const vel = Math.max(1, Math.min(100, Math.round(velocity + (random() - 0.5) * 5)));
  events.push({ time, type: "on", note: midi, velocity: vel });
  events.push({ time: time + length * beat, type: "off", note: midi });
  notes.push({
    part,
    midi,
    beat: b,
    time,
    off: time + length * beat,
    durationBeats: length,
    velocity: vel,
  });
};
const harmonies = [
  { name: "Dadd9", bass: 50, voices: [57, 62, 64, 66] },
  { name: "Aadd9/C#", bass: 49, voices: [57, 59, 64, 69] },
  { name: "Bm7", bass: 47, voices: [57, 59, 62, 66] },
  { name: "Gmaj9", bass: 43, voices: [57, 59, 62, 66] },
  { name: "Dadd9/F#", bass: 42, voices: [57, 62, 64, 66] },
  { name: "Em9", bass: 40, voices: [55, 59, 62, 66] },
  { name: "Gmaj9", bass: 43, voices: [57, 59, 62, 66] },
  { name: "Asus4 → A", bass: 45, voices: [57, 59, 62, 64] },
];
const sequence = [...Array.from({ length: 16 }, (_, i) => i % 8), 2, 3, 7, 0];
const bars = [];
for (let bar = 0; bar < 20; bar++) {
  const h = harmonies[sequence[bar]];
  const b = bar * 4;
  const lift = bar >= 16 ? 8 : bar >= 8 ? 3 : 0;
  bars.push({ bar: bar + 1, start: b * beat, chord: h.name });
  // Release the pedal just before each harmonic change, then catch the new chord.
  events.push({ time: Math.max(0, b * beat - 0.025), type: "cc", controller: 64, value: 0 });
  events.push({ time: b * beat + 0.045, type: "cc", controller: 64, value: 83 });
  note("left", h.bass, b, 1.5, 52 + lift);
  note("left", h.bass + 12, b + 2, 1.35, 43 + lift);
  if (bar >= 4) note("left", h.bass + 7, b + 1.5, 0.55, 36 + lift);
  const pattern = bar % 2 ? [0, 2, 1, 3, 1, 2, 0, 2] : [0, 2, 1, 3, 0, 2, 1, 2];
  for (let i = 0; i < 8; i++) {
    let pitch = h.voices[pattern[i]];
    if (sequence[bar] === 7 && i >= 6 && pitch === 62) pitch = 61;
    const accent = [51, 42, 46, 43, 52, 44, 47, 43][i];
    note("pulse", pitch, b + i / 2, 0.43, accent + lift);
  }
  if (bar >= 16) {
    // A little more motion for the accelerating match, without a tempo jump.
    for (const [offset, voice] of [
      [1.75, 2],
      [3.25, 1],
      [3.75, 3],
    ])
      note("lift", h.voices[voice] + 12, b + offset, 0.2, 38 + lift);
  }
}
// One clear, recurring two-bar melody. Sparse phrases leave the rules readable.
const phrases = [
  {
    bar: 2,
    notes: [
      [0, 78, 0.8],
      [1.5, 76, 0.45],
      [2.5, 74, 1.1],
      [4, 71, 1.1],
      [5.5, 73, 0.45],
      [6.5, 74, 1.1],
    ],
  },
  {
    bar: 6,
    notes: [
      [0, 78, 1.25],
      [1.5, 76, 0.75],
      [3, 74, 0.6],
      [4, 73, 1.1],
      [5.5, 71, 0.45],
      [6.5, 73, 0.75],
    ],
  },
  {
    bar: 10,
    notes: [
      [0, 78, 0.8],
      [1.5, 76, 0.45],
      [2.5, 74, 1.1],
      [4, 71, 1.1],
      [5.5, 73, 0.45],
      [6.5, 74, 1.1],
    ],
  },
  {
    bar: 14,
    notes: [
      [0, 78, 1.25],
      [1.5, 81, 0.75],
      [3, 78, 0.6],
      [4, 76, 1.1],
      [5.5, 74, 0.45],
      [6.5, 73, 0.75],
    ],
  },
  {
    bar: 16,
    notes: [
      [0, 78, 0.75],
      [1, 76, 0.5],
      [2, 74, 0.75],
      [3, 73, 0.5],
      [4, 71, 0.75],
      [5, 73, 0.5],
      [6, 74, 1],
    ],
  },
  {
    bar: 18,
    notes: [
      [0, 76, 0.75],
      [1, 78, 0.5],
      [2, 81, 0.8],
      [3.5, 78, 0.4],
      [4, 78, 0.75],
      [5, 76, 0.5],
      [6, 74, 1.25],
    ],
  },
];
for (const phrase of phrases)
  for (const [b, pitch, length] of phrase.notes)
    note("melody", pitch, phrase.bar * 4 + b, length, phrase.bar >= 16 ? 66 : 59);
// The final D-major ninth lands on the logo at exactly 48.2 seconds.
events.push({ time: 48.17, type: "cc", controller: 64, value: 0 });
for (const [i, pitch] of [38, 50, 57, 62, 66, 69, 76].entries())
  note("resolve", pitch, 80 + i * 0.018, 4.5, 56 - i * 1.2);
events.push({ time: 48.27, type: "cc", controller: 64, value: 100 });
events.push({ time: 52.1, type: "cc", controller: 64, value: 0 });
const eventPriority = { off: 0, cc: 1, on: 2 };
events.sort((a, b) => a.time - b.time || eventPriority[a.type] - eventPriority[b.type]);
const score = {
  title: "Next Move",
  provenance:
    "Original composition and explicit programmed performance made for Tiao; not a text-to-audio model output or a stock loop.",
  tempoBpm: 60 / beat,
  key: "D major",
  meter: "4/4",
  duration: 54,
  trailerDuration: 50.2,
  resolveAt: 48.2,
  instrument:
    "/Library/Application Support/Logic/EXS Factory Samples/01 Acoustic Pianos/Yamaha Grand Piano",
  bars,
  notes,
  events,
};
writeFileSync(resolve(root, "piano-score.json"), JSON.stringify(score, null, 2) + "\n");
// A standard type-0 MIDI file keeps the arrangement editable in a DAW.
const variable = (value) => {
  const bytes = [value & 0x7f];
  let remaining = value >>> 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  return bytes;
};
const u32 = (value) =>
  Buffer.from([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
const tempo = Math.round(beat * 1e6);
const track = [0, 0xff, 0x51, 3, tempo >>> 16, (tempo >>> 8) & 255, tempo & 255, 0, 0xc0, 0];
let previous = 0;
for (const event of events) {
  const tick = Math.round((event.time / beat) * 480);
  track.push(...variable(tick - previous));
  if (event.type === "on") track.push(0x90, event.note, event.velocity);
  else if (event.type === "off") track.push(0x80, event.note, 0);
  else track.push(0xb0, event.controller, event.value);
  previous = tick;
}
track.push(0, 0xff, 0x2f, 0);
writeFileSync(
  resolve(root, "next-move.mid"),
  Buffer.concat([
    Buffer.from("MThd"),
    u32(6),
    Buffer.from([0, 0, 0, 1, 1, 224]),
    Buffer.from("MTrk"),
    u32(track.length),
    Buffer.from(track),
  ]),
);
console.log(
  JSON.stringify({
    title: score.title,
    tempoBpm: score.tempoBpm,
    notes: notes.length,
    duration: score.duration,
  }),
);
