/** Deterministic, sample-free synthesis shared by browser playback and WAV export. */
export type UiSoundCategory = "click" | "success" | "error";
export type ClickRecipe = {
  id: string;
  name: string;
  material: string;
  category: UiSoundCategory;
  duration: number;
  frequency: number;
  decay: number;
  partials: readonly number[];
  noise: number;
  smoothing: number;
  attack: number;
  cutoff: number;
  level: number;
  secondTap?: number;
  secondFrequency?: number;
};

const felt = {
  duration: 0.12,
  frequency: 160,
  decay: 48,
  partials: [1],
  noise: 0.35,
  smoothing: 0.96,
  attack: 0.009,
  cutoff: 500,
  level: 0.22,
} as const;

export const UI_CLICKS: readonly ClickRecipe[] = [
  { ...felt, category: "click", id: "felt", name: "Felt", material: "Soft · short" },
  {
    ...felt,
    category: "click",
    id: "velvet",
    name: "Velvet",
    material: "Low · cushioned",
    frequency: 105,
    cutoff: 340,
    noise: 0.6,
    level: 0.19,
    attack: 0.012,
  },
  {
    ...felt,
    category: "click",
    id: "linen",
    name: "Linen",
    material: "Airy · muted",
    frequency: 190,
    cutoff: 580,
    noise: 1.7,
    smoothing: 0.94,
    level: 0.18,
    duration: 0.1,
  },
  {
    ...felt,
    category: "click",
    id: "cork",
    name: "Cork",
    material: "Dry · rounded",
    frequency: 220,
    cutoff: 650,
    noise: 0.25,
    duration: 0.085,
    decay: 65,
    attack: 0.007,
    level: 0.2,
  },
  {
    ...felt,
    category: "click",
    id: "brush",
    name: "Brush",
    material: "Texture · no tone",
    partials: [],
    noise: 1,
    smoothing: 0.94,
    cutoff: 600,
    duration: 0.11,
    level: 0.16,
  },
  {
    ...felt,
    category: "click",
    id: "low-felt",
    name: "Low felt",
    material: "Deep · barely there",
    frequency: 130,
    cutoff: 380,
    noise: 0.25,
    level: 0.13,
  },
];

export const UI_SUCCESSES: readonly ClickRecipe[] = [
  {
    ...felt,
    category: "success",
    id: "settle",
    name: "Settle",
    material: "One soft landing",
    frequency: 195,
    duration: 0.19,
    decay: 30,
    attack: 0.015,
    level: 0.24,
  },
  {
    ...felt,
    category: "success",
    id: "warm-confirm",
    name: "Warm confirm",
    material: "Two gentle taps",
    frequency: 170,
    secondFrequency: 220,
    secondTap: 0.085,
    duration: 0.26,
    decay: 38,
    attack: 0.012,
    level: 0.23,
  },
  {
    ...felt,
    category: "success",
    id: "soft-open",
    name: "Soft open",
    material: "Light · rounded",
    frequency: 245,
    duration: 0.18,
    decay: 32,
    cutoff: 680,
    attack: 0.018,
    level: 0.19,
  },
  {
    ...felt,
    category: "success",
    id: "quiet-confirm",
    name: "Quiet confirm",
    material: "Low · understated",
    frequency: 145,
    secondFrequency: 170,
    secondTap: 0.075,
    duration: 0.22,
    cutoff: 400,
    level: 0.17,
  },
];

export const UI_ERRORS: readonly ClickRecipe[] = [
  {
    ...felt,
    category: "error",
    id: "soft-pause",
    name: "Soft pause",
    material: "Low · single tap",
    frequency: 115,
    duration: 0.19,
    decay: 32,
    cutoff: 330,
    attack: 0.014,
    level: 0.23,
  },
  {
    ...felt,
    category: "error",
    id: "low-double",
    name: "Low double",
    material: "Two muffled taps",
    frequency: 145,
    secondFrequency: 115,
    secondTap: 0.085,
    duration: 0.25,
    cutoff: 400,
    attack: 0.012,
    level: 0.22,
  },
  {
    ...felt,
    category: "error",
    id: "soft-close",
    name: "Soft close",
    material: "Damped · brief",
    frequency: 180,
    duration: 0.15,
    cutoff: 480,
    noise: 0.7,
    attack: 0.012,
    level: 0.18,
  },
  {
    ...felt,
    category: "error",
    id: "quiet-pause",
    name: "Quiet pause",
    material: "Soft texture · no tone",
    partials: [],
    noise: 1,
    smoothing: 0.97,
    duration: 0.18,
    cutoff: 420,
    attack: 0.018,
    decay: 32,
    level: 0.17,
  },
];

export const UI_SOUNDS = [...UI_CLICKS, ...UI_SUCCESSES, ...UI_ERRORS];
export const UI_SOUND_CATEGORIES: readonly UiSoundCategory[] = ["click", "success", "error"];
export const UI_SOUND_LABELS = { click: "Click", success: "Success", error: "Error" } as const;

export function synthesizeClick(recipe: ClickRecipe, sampleRate = 44100): Float32Array {
  const samples = new Float32Array(Math.ceil(recipe.duration * sampleRate));
  const starts = recipe.secondTap ? [0, recipe.secondTap] : [0];
  const coefficient = 1 - Math.exp((-2 * Math.PI * recipe.cutoff) / sampleRate);
  let seed = 0x1234abcd;
  let filteredNoise = 0;
  let lowPass = 0;
  let lowPass2 = 0;
  let energy = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    filteredNoise = recipe.smoothing * filteredNoise + (1 - recipe.smoothing) * (seed / 2147483648);
    let value = 0;
    starts.forEach((start, pulse) => {
      const elapsed = t - start;
      if (elapsed < 0) return;
      const frequency = pulse ? (recipe.secondFrequency ?? recipe.frequency) : recipe.frequency;
      const phase = 2 * Math.PI * frequency * elapsed;
      const tone = recipe.partials.reduce(
        (sum, ratio, index) => sum + Math.sin(phase * ratio) / (1 + index * 2.8),
        0,
      );
      const attack = Math.sin((Math.min(1, elapsed / recipe.attack) * Math.PI) / 2) ** 2;
      value +=
        attack *
        (tone * Math.exp(-elapsed * recipe.decay) +
          recipe.noise * filteredNoise * Math.exp(-elapsed * recipe.decay * 1.6));
    });
    lowPass += coefficient * (value - lowPass);
    lowPass2 += coefficient * (lowPass - lowPass2);
    value = lowPass2 * Math.min(1, (recipe.duration - t) / 0.015);
    samples[i] = value;
    energy += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  // Preserve the quieter recipe levels; never normalize them back to full volume.
  const gain =
    peak > 0
      ? Math.min(0.6 / peak, 0.045 / Math.sqrt(energy / (sampleRate * 0.2))) * recipe.level
      : 0;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  samples[0] = 0;
  samples[samples.length - 1] = 0;
  return samples;
}
