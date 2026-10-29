/** Usage: node --experimental-strip-types scripts/export-ui-clicks.ts /absolute/output/directory */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { synthesizeClick, UI_SOUNDS } from "../client/src/lib/uiClickSynth.ts";
import {
  DEFAULT_UI_SOUNDS,
  UI_OUTPUT_GAIN,
  uiPlaybackGain,
} from "../client/src/lib/uiSoundPresets.ts";

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
const selectedOnly = process.argv.includes("--selected");
const recipes = selectedOnly
  ? UI_SOUNDS.filter((sound) => Object.values(DEFAULT_UI_SOUNDS).includes(sound.id))
  : UI_SOUNDS;
const montage = new Float32Array(recipes.length * sampleRate);
const metrics: Record<string, { gain: number; peak: number; rms200ms: number }> = {};
recipes.forEach((recipe, index) => {
  const samples = synthesizeClick(recipe, sampleRate);
  const gain = uiPlaybackGain(recipe.id, 0.5);
  let peak = 0;
  let energy = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] *= gain;
    peak = Math.max(peak, Math.abs(samples[i]));
    energy += samples[i] ** 2;
  }
  metrics[recipe.id] = { gain, peak, rms200ms: Math.sqrt(energy / (sampleRate * 0.2)) };
  const filename = `${String(index + 1).padStart(2, "0")}-${recipe.id}.wav`;
  writeFileSync(resolve(destination, filename), wav(samples));
  montage.set(samples, index * sampleRate);
});
writeFileSync(
  resolve(destination, selectedOnly ? "selected-ui-sounds.wav" : "ui-sound-montage.wav"),
  wav(montage),
);
writeFileSync(resolve(destination, "sounds.json"), JSON.stringify(recipes, null, 2));
writeFileSync(
  resolve(destination, "mix-settings.json"),
  JSON.stringify(
    { defaults: DEFAULT_UI_SOUNDS, volume: 0.5, outputGain: UI_OUTPUT_GAIN, metrics },
    null,
    2,
  ),
);
console.log(`Exported ${recipes.length} sounds and montage to ${destination}`);
