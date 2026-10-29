import { safeLocalStorage } from "./safeLocalStorage";
import { synthesizeClick, UI_CLICKS } from "./uiClickSynth";

export const UI_CLICK_KEY = "tiao:uiClick";
export const UI_CLICK_VOLUME_KEY = "tiao:uiClickVolume";
let context: AudioContext | undefined;
let generation = 0;
const sources = new Set<AudioBufferSourceNode>();
const buffers = new Map<string, AudioBuffer>();

export function getClickVolume(): number {
  const stored = safeLocalStorage.getItem(UI_CLICK_VOLUME_KEY);
  const value = stored === null ? 0.65 : Number(stored);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.65;
}

export function stopUiClicks() {
  generation++;
  for (const source of sources) source.stop();
  sources.clear();
}

export async function playUiClick(id: string, volume = getClickVolume()): Promise<boolean> {
  if (safeLocalStorage.getItem("tiao:soundEnabled") === "0") return false;
  const recipe = UI_CLICKS.find((sound) => sound.id === id);
  if (!recipe || typeof window === "undefined" || !window.AudioContext) return false;
  const request = generation;
  try {
    context ??= new AudioContext();
    if (context.state !== "running") await context.resume();
    if (request !== generation || safeLocalStorage.getItem("tiao:soundEnabled") === "0")
      return false;
    let buffer = buffers.get(id);
    if (!buffer) {
      buffer = context.createBuffer(
        1,
        Math.ceil(recipe.duration * context.sampleRate),
        context.sampleRate,
      );
      buffer.getChannelData(0).set(synthesizeClick(recipe, context.sampleRate));
      buffers.set(id, buffer);
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));
    source.buffer = buffer;
    source.connect(gain).connect(context.destination);
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start();
    return true;
  } catch {
    return false;
  }
}
