#!/usr/bin/env node
// Build the runtime artwork from the same curated masters used by Steam.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAchievements } from "./steam-achievements.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "scripts/assets/achievement-icons");
const destination = join(root, "client/public/achievement-icons");
const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
const achievements = parseAchievements();
const icons = new Map(manifest.icons.map((icon) => [icon.id, icon]));
if (manifest.icons.length !== achievements.length || icons.size !== achievements.length) {
  throw new Error("Curated artwork must contain exactly one master per achievement");
}

// Validate every source before changing any runtime files.
for (const achievement of achievements) {
  const icon = icons.get(achievement.id);
  if (!icon || icon.steamKey !== achievement.steamKey || icon.tier !== achievement.tier) {
    throw new Error(`Artwork mapping mismatch: ${achievement.id}`);
  }
  const hash = createHash("sha256")
    .update(readFileSync(join(source, icon.master)))
    .digest("hex");
  if (hash !== icon.sha256) throw new Error(`Artwork checksum mismatch: ${achievement.id}`);
}

mkdirSync(destination, { recursive: true });
const artwork = {};
const currentFiles = new Set();
for (const achievement of achievements) {
  const icon = icons.get(achievement.id);
  const bytes = execFileSync(
    "magick",
    [
      "-limit",
      "thread",
      "1",
      "-limit",
      "memory",
      "128MiB",
      join(source, icon.master),
      "-resize",
      "128x128",
      "-background",
      "white",
      "-gravity",
      "center",
      "-extent",
      "128x128",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-strip",
      "-quality",
      "90",
      "webp:-",
    ],
    { env: { ...process.env, MAGICK_THREAD_LIMIT: "1", OMP_NUM_THREADS: "1" } },
  );
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const filename = `${achievement.id}.${hash}.webp`;
  writeFileSync(join(destination, filename), bytes);
  artwork[achievement.id] = `/achievement-icons/${filename}`;
  currentFiles.add(filename);
}
writeFileSync(
  join(root, "client/src/lib/achievementArtwork.json"),
  `${JSON.stringify(artwork, null, 2)}\n`,
);
for (const filename of readdirSync(destination)) {
  if (/^[a-z-]+\.[a-f0-9]{12}\.webp$/.test(filename) && !currentFiles.has(filename)) {
    rmSync(join(destination, filename));
  }
}
console.log(`Exported ${achievements.length} runtime achievement icons.`);
