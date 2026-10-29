import type { UiSoundCategory } from "./uiClickSynth";

/** Curated production defaults; the audition lab can override or turn off each category. */
export const DEFAULT_UI_SOUNDS: Record<UiSoundCategory, string> = {
  click: "linen",
  success: "warm-confirm",
  error: "low-double",
};
export const UI_OUTPUT_GAIN = 1.3;
const balance: Record<string, number> = {
  linen: 0.22 / 0.18,
  "warm-confirm": 0.22 / 0.23,
  "low-double": 1,
};

/** Match the selected cues' energy, with a modest gain increase and ample headroom. */
export function uiPlaybackGain(id: string, volume: number): number {
  const safeVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
  return safeVolume * UI_OUTPUT_GAIN * (balance[id] ?? 1);
}
