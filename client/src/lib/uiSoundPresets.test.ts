import { describe, expect, it } from "vitest";
import { synthesizeClick, UI_SOUNDS } from "./uiClickSynth";
import { DEFAULT_UI_SOUNDS, uiPlaybackGain } from "./uiSoundPresets";

describe("curated game sound mix", () => {
  it("balances the selected cues at a modestly raised level without clipping", () => {
    const energies: number[] = [];
    for (const id of Object.values(DEFAULT_UI_SOUNDS)) {
      const recipe = UI_SOUNDS.find((sound) => sound.id === id)!;
      const samples = synthesizeClick(recipe, 44100);
      const gain = uiPlaybackGain(id, 0.5);
      let energy = 0;
      let peak = 0;
      for (const sample of samples) {
        energy += (sample * gain) ** 2;
        peak = Math.max(peak, Math.abs(sample * uiPlaybackGain(id, 1)));
      }
      const rms = Math.sqrt(energy / (44100 * 0.2));
      energies.push(rms);
      expect(peak).toBeLessThan(0.2);
      expect(rms).toBeGreaterThan(0.006);
      expect(gain).toBeGreaterThan(0.5);
      expect(gain).toBeLessThan(0.8);
    }
    expect(Math.max(...energies) / Math.min(...energies)).toBeLessThan(1.01);
  });
  it("keeps volume zero silent and rejects non-finite gain inputs", () => {
    expect(uiPlaybackGain("linen", 0)).toBe(0);
    expect(uiPlaybackGain("linen", Number.NaN)).toBe(0);
    expect(uiPlaybackGain("linen", -1)).toBe(0);
  });
});
