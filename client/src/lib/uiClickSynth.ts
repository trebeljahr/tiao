/** Deterministic mono synthesis shared by the browser and WAV export. No samples. */
export type ClickRecipe = {
  id: string;
  name: string;
  material: string;
  duration: number;
  frequency: number;
  decay: number;
  partials: readonly number[];
  noise: number;
  smoothing: number;
  sweep?: number;
  secondTap?: number;
};

export const UI_CLICKS: readonly ClickRecipe[] = [
  {
    id: "bamboo",
    name: "Bamboo",
    material: "Hollow · dry",
    duration: 0.09,
    frequency: 780,
    decay: 55,
    partials: [1, 2.73, 4.8],
    noise: 0.18,
    smoothing: 0.35,
  },
  {
    id: "walnut",
    name: "Walnut",
    material: "Low · woody",
    duration: 0.1,
    frequency: 390,
    decay: 48,
    partials: [1, 2.4, 4.1],
    noise: 0.25,
    smoothing: 0.65,
  },
  {
    id: "woodblock",
    name: "Woodblock",
    material: "Bright · hollow",
    duration: 0.1,
    frequency: 1050,
    decay: 48,
    partials: [1, 1.53, 3.7],
    noise: 0.08,
    smoothing: 0.25,
  },
  {
    id: "paper",
    name: "Paper",
    material: "Soft · textured",
    duration: 0.055,
    frequency: 1800,
    decay: 95,
    partials: [1],
    noise: 2.2,
    smoothing: 0.2,
  },
  {
    id: "felt",
    name: "Felt",
    material: "Muted · warm",
    duration: 0.09,
    frequency: 240,
    decay: 65,
    partials: [1, 2],
    noise: 0.7,
    smoothing: 0.92,
  },
  {
    id: "pebble",
    name: "Pebble",
    material: "Small · stony",
    duration: 0.075,
    frequency: 1450,
    decay: 75,
    partials: [1, 1.47, 2.09],
    noise: 0.32,
    smoothing: 0.4,
  },
  {
    id: "ceramic",
    name: "Ceramic",
    material: "Rounded · resonant",
    duration: 0.15,
    frequency: 1250,
    decay: 35,
    partials: [1, 2.71, 4.34],
    noise: 0.03,
    smoothing: 0.3,
  },
  {
    id: "glass",
    name: "Glass",
    material: "Clear · delicate",
    duration: 0.19,
    frequency: 2200,
    decay: 28,
    partials: [1, 2.32, 3.83],
    noise: 0.01,
    smoothing: 0.1,
  },
  {
    id: "drop",
    name: "Water drop",
    material: "Liquid · falling",
    duration: 0.12,
    frequency: 1550,
    decay: 48,
    partials: [1, 2],
    noise: 0.015,
    smoothing: 0.6,
    sweep: -1050,
  },
  {
    id: "bubble",
    name: "Bubble",
    material: "Round · playful",
    duration: 0.11,
    frequency: 420,
    decay: 45,
    partials: [1, 2],
    noise: 0.02,
    smoothing: 0.6,
    sweep: 500,
  },
  {
    id: "soft-pop",
    name: "Soft pop",
    material: "Warm · springy",
    duration: 0.085,
    frequency: 680,
    decay: 60,
    partials: [1, 2.01],
    noise: 0.06,
    smoothing: 0.75,
    sweep: -460,
  },
  {
    id: "switch",
    name: "Switch",
    material: "Mechanical · double",
    duration: 0.07,
    frequency: 1750,
    decay: 130,
    partials: [1, 1.8],
    noise: 0.9,
    smoothing: 0.25,
    secondTap: 0.022,
  },
  {
    id: "snap",
    name: "Snap",
    material: "Crisp · short",
    duration: 0.045,
    frequency: 2400,
    decay: 150,
    partials: [1, 2.7],
    noise: 1.6,
    smoothing: 0.1,
  },
  {
    id: "pixel",
    name: "Pixel",
    material: "Digital · tiny",
    duration: 0.065,
    frequency: 920,
    decay: 75,
    partials: [1, 3, 5, 7],
    noise: 0,
    smoothing: 0,
    sweep: -160,
  },
  {
    id: "chime",
    name: "Chime",
    material: "Musical · light",
    duration: 0.2,
    frequency: 1320,
    decay: 27,
    partials: [1, 1.5, 2],
    noise: 0,
    smoothing: 0,
  },
  {
    id: "blip",
    name: "Blip",
    material: "Clean · rising",
    duration: 0.085,
    frequency: 600,
    decay: 65,
    partials: [1],
    noise: 0,
    smoothing: 0,
    sweep: 1100,
  },
];

export function synthesizeClick(recipe: ClickRecipe, sampleRate = 44100): Float32Array {
  const samples = new Float32Array(Math.ceil(recipe.duration * sampleRate));
  let seed = 0x1234abcd;
  let filtered = 0;
  let energy = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const noise = seed / 2147483648;
    filtered = recipe.smoothing * filtered + (1 - recipe.smoothing) * noise;
    let value = 0;
    for (const start of recipe.secondTap ? [0, recipe.secondTap] : [0]) {
      const elapsed = t - start;
      if (elapsed < 0) continue;
      const phase =
        2 *
        Math.PI *
        (recipe.frequency * elapsed +
          ((recipe.sweep ?? 0) * elapsed * elapsed) / (2 * recipe.duration));
      const tone = recipe.partials.reduce(
        (sum, ratio, index) => sum + Math.sin(phase * ratio) / (1 + index * 2.8),
        0,
      );
      const attack = Math.min(1, elapsed / 0.0015);
      value +=
        attack *
        (tone * Math.exp(-elapsed * recipe.decay) +
          recipe.noise * filtered * Math.exp(-elapsed * recipe.decay * 1.6));
    }
    value *= Math.min(1, (recipe.duration - t) / 0.008);
    samples[i] = value;
    energy += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  // Match energy over a fixed listening window, capped to leave headroom.
  const gain = Math.min(0.6 / peak, 0.045 / Math.sqrt(energy / (sampleRate * 0.2)));
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  samples[0] = 0;
  samples[samples.length - 1] = 0;
  return samples;
}
