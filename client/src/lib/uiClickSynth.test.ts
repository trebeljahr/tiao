import { describe, expect, it } from "vitest";
import { synthesizeClick, UI_CLICKS } from "./uiClickSynth";

describe("UI click synthesis", () => {
  it("renders every candidate deterministically without clipping or hard endpoints", () => {
    for (const recipe of UI_CLICKS) {
      for (const sampleRate of [44100, 48000]) {
        const samples = synthesizeClick(recipe, sampleRate);
        expect(samples).toHaveLength(Math.ceil(recipe.duration * sampleRate));
        expect(samples[0]).toBe(0);
        expect(samples.at(-1)).toBe(0);
        let peak = 0;
        let energy = 0;
        const repeated = synthesizeClick(recipe, sampleRate);
        let identical = true;
        for (let i = 0; i < samples.length; i++) {
          const value = samples[i];
          peak = Math.max(peak, Math.abs(value));
          energy += value * value;
          identical &&= value === repeated[i];
        }
        expect(Number.isFinite(energy)).toBe(true);
        expect(identical).toBe(true);
        expect(peak).toBeLessThanOrEqual(0.601);
        expect(energy).toBeGreaterThan(0);
      }
    }
  });
});
