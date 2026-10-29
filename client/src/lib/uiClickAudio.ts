import { safeLocalStorage } from "./safeLocalStorage";
import { synthesizeClick, UI_SOUNDS, type UiSoundCategory } from "./uiClickSynth";

export const UI_CLICK_KEY = "tiao:uiClick";
export const UI_SOUND_KEYS = {
  click: UI_CLICK_KEY,
  success: "tiao:uiSuccess",
  error: "tiao:uiError",
} as const;
export const UI_CLICK_VOLUME_KEY = "tiao:uiClickVolume";
let context: AudioContext | undefined;
let generation = 0;
const sources = new Set<AudioBufferSourceNode>();
const buffers = new Map<string, AudioBuffer>();

export function getClickVolume(): number {
  const stored = safeLocalStorage.getItem(UI_CLICK_VOLUME_KEY);
  const value = stored === null ? 0.5 : Number(stored);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

export function stopUiClicks() {
  generation++;
  for (const source of sources) source.stop();
  sources.clear();
}

export async function playUiClick(id: string, volume = getClickVolume()): Promise<boolean> {
  if (safeLocalStorage.getItem("tiao:soundEnabled") === "0") return false;
  const recipe = UI_SOUNDS.find((sound) => sound.id === id);
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

export function soundVolumeKey(category: UiSoundCategory) {
  return category === "click"
    ? UI_CLICK_VOLUME_KEY
    : category === "success"
      ? "tiao:uiSuccessVolume"
      : "tiao:uiErrorVolume";
}

export function getUiSoundVolume(category: UiSoundCategory): number {
  if (category === "click") return getClickVolume();
  const raw = safeLocalStorage.getItem(soundVolumeKey(category));
  const value = raw === null ? 0.5 : Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

export function getUiSoundSelection(category: UiSoundCategory): string | null {
  const id = safeLocalStorage.getItem(UI_SOUND_KEYS[category]);
  return UI_SOUNDS.some((sound) => sound.id === id && sound.category === category) ? id : null;
}

/** Call only for an actual user action result; saved categories are opt-in. */
export function playUiFeedback(category: UiSoundCategory): Promise<boolean> {
  const id = getUiSoundSelection(category);
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("tiao:ui-feedback", { detail: category }));
  return id ? playUiClick(id, getUiSoundVolume(category)) : Promise.resolve(false);
}
