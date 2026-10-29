import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getUiSoundSelection,
  getUiSoundVolume,
  playUiFeedback,
  UI_SOUND_KEYS,
} from "./uiClickAudio";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
describe("category sound preferences and playback", () => {
  it("keeps categories silent until selected, rejects wrong-category IDs and clamps volume", async () => {
    localStorage.clear();
    expect(await playUiFeedback("success")).toBe(false);
    localStorage.setItem(UI_SOUND_KEYS.success, "felt");
    expect(getUiSoundSelection("success")).toBeNull();
    localStorage.setItem("tiao:uiSuccessVolume", "100");
    expect(getUiSoundVolume("success")).toBe(1);
    localStorage.setItem("tiao:uiSuccessVolume", "garbage");
    expect(getUiSoundVolume("success")).toBe(0.5);
  });
  it("plays independent selected categories once and honours the game mute setting", async () => {
    const start = vi.fn();
    const gainValues: number[] = [];
    class FakeAudioContext {
      sampleRate = 44100;
      state = "running";
      destination = {};
      createBuffer(_channels: number, length: number) {
        return { getChannelData: () => new Float32Array(length) };
      }
      createGain() {
        const node = { gain: { value: 0 }, connect: () => ({}), disconnect: vi.fn() };
        Object.defineProperty(node.gain, "value", {
          set: (value: number) => gainValues.push(value),
        });
        return node;
      }
      createBufferSource() {
        return {
          buffer: null,
          connect: (node: unknown) => node,
          disconnect: vi.fn(),
          start,
          stop: vi.fn(),
          onended: null,
        };
      }
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);
    localStorage.setItem(UI_SOUND_KEYS.click, "felt");
    localStorage.setItem(UI_SOUND_KEYS.success, "settle");
    localStorage.setItem(UI_SOUND_KEYS.error, "soft-pause");
    localStorage.setItem("tiao:uiClickVolume", "0.3");
    localStorage.setItem("tiao:uiSuccessVolume", "0.4");
    localStorage.setItem("tiao:uiErrorVolume", "0.2");
    for (const category of ["click", "success", "error"] as const)
      expect(await playUiFeedback(category)).toBe(true);
    expect(start).toHaveBeenCalledTimes(3);
    expect(gainValues).toEqual([0.3, 0.4, 0.2]);
    localStorage.setItem("tiao:soundEnabled", "0");
    expect(await playUiFeedback("error")).toBe(false);
    expect(start).toHaveBeenCalledTimes(3);
  });
});
