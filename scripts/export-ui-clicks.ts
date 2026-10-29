/** Usage: node --experimental-strip-types scripts/export-ui-clicks.ts /absolute/output/directory */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { synthesizeClick, UI_CLICKS } from "../client/src/lib/uiClickSynth.ts";

const destination = process.argv[2];
if (!destination) throw new Error("Pass an output directory.");
mkdirSync(destination, { recursive: true });
const sampleRate = 44100;
function wav(samples: Float32Array) {
  const file = Buffer.alloc(44 + samples.length * 2);
  file.write("RIFF", 0);
  file.writeUInt32LE(file.length - 8, 4);
  file.write("WAVEfmt ", 8);
  file.writeUInt32LE(16, 16);
  file.writeUInt16LE(1, 20);
  file.writeUInt16LE(1, 22);
  file.writeUInt32LE(sampleRate, 24);
  file.writeUInt32LE(sampleRate * 2, 28);
  file.writeUInt16LE(2, 32);
  file.writeUInt16LE(16, 34);
  file.write("data", 36);
  file.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, index) => {
    file.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + index * 2);
  });
  return file;
}
const montage = new Float32Array(Math.ceil(UI_CLICKS.length * 1.45 * sampleRate));
UI_CLICKS.forEach((recipe, index) => {
  const samples = synthesizeClick(recipe, sampleRate);
  const filename = `${String(index + 1).padStart(2, "0")}-${recipe.id}.wav`;
  writeFileSync(resolve(destination, filename), wav(samples));
  for (const offset of [0, 0.29, 0.67]) {
    const start = Math.round((index * 1.45 + offset) * sampleRate);
    samples.forEach((value, i) => {
      montage[start + i] += value * 0.65;
    });
  }
});
writeFileSync(resolve(destination, "ui-click-montage.wav"), wav(montage));
writeFileSync(resolve(destination, "sounds.json"), JSON.stringify(UI_CLICKS, null, 2));
console.log(`Exported ${UI_CLICKS.length} sounds and montage to ${destination}`);
