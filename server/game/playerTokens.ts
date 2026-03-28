/**
 * Player name utilities — fun anonymous name generator and display name helpers.
 * Session management has moved to better-auth (see server/auth/).
 */

// ─── Fun Anonymous Name Generator ───────────────────────────────────

const ADJECTIVES = [
  "brave",
  "clever",
  "swift",
  "gentle",
  "bold",
  "calm",
  "bright",
  "kind",
  "wise",
  "lucky",
  "happy",
  "keen",
  "cool",
  "free",
  "warm",
  "wild",
  "quiet",
  "proud",
  "fair",
  "crisp",
  "merry",
  "witty",
  "noble",
  "plucky",
  "daring",
  "vivid",
  "jolly",
  "nimble",
  "hardy",
  "sleek",
  "eager",
  "loyal",
  "zesty",
  "chill",
  "spry",
  "peppy",
  "sunny",
  "cozy",
  "snappy",
  "fluffy",
  "mighty",
  "tiny",
  "fancy",
  "funky",
  "dizzy",
  "perky",
  "sassy",
  "cosmic",
  "stellar",
  "wistful",
];

const COLORS = [
  "pink",
  "golden",
  "azure",
  "coral",
  "amber",
  "jade",
  "ruby",
  "ivory",
  "silver",
  "teal",
  "crimson",
  "violet",
  "copper",
  "scarlet",
  "indigo",
  "peach",
  "olive",
  "bronze",
  "cobalt",
  "lilac",
  "onyx",
  "sage",
  "honey",
  "rust",
  "plum",
  "mint",
  "slate",
  "mauve",
  "opal",
  "pearl",
  "khaki",
  "denim",
  "lemon",
  "tangerine",
  "cyan",
  "magenta",
  "charcoal",
  "cream",
  "saffron",
  "turquoise",
];

const ANIMALS = [
  "fox",
  "owl",
  "bear",
  "wolf",
  "hawk",
  "deer",
  "lion",
  "dove",
  "seal",
  "crow",
  "hare",
  "frog",
  "swan",
  "lynx",
  "wren",
  "eagle",
  "otter",
  "panda",
  "tiger",
  "koala",
  "raven",
  "whale",
  "bison",
  "crane",
  "finch",
  "gecko",
  "heron",
  "ibis",
  "jaguar",
  "lemur",
  "moose",
  "newt",
  "oriole",
  "parrot",
  "quail",
  "robin",
  "shark",
  "toucan",
  "viper",
  "walrus",
  "zebra",
  "badger",
  "cobra",
  "dingo",
  "egret",
  "falcon",
  "gopher",
  "hippo",
  "iguana",
  "jackal",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateFunAnonymousName(): string {
  return `${pick(ADJECTIVES)}-${pick(COLORS)}-${pick(ANIMALS)}`;
}

// ─── Display Name Helpers ───────────────────────────────────────────

export function sanitizeDisplayName(displayName?: string): string {
  const trimmed = displayName?.trim();
  if (!trimmed) {
    return generateFunAnonymousName();
  }

  return trimmed.slice(0, 32);
}

export function deriveDisplayNameFromEmail(email: string): string {
  const [localPart] = email.split("@");
  return sanitizeDisplayName(localPart || "Player");
}
