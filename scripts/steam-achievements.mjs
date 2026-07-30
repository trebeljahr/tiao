#!/usr/bin/env node
/*
 * steam-achievements — turn `shared/src/achievements.ts` into the shapes
 * the Steamworks Partner Portal needs.
 *
 * Steam has no bulk achievement import. Every achievement is typed into
 * a web form by hand (App Admin → Community → Achievements), and a typo
 * in an API name produces no error anywhere: `unlockAchievement()` for a
 * name Steam doesn't recognise is silently discarded. With 30
 * achievements that is a lot of chances to break something invisibly.
 *
 * So this script does two things:
 *
 *   1. `--check` (the mode CI runs) validates the definitions against
 *      Steam's constraints before anyone starts typing.
 *   2. The output formats give you something to copy from, and a
 *      manifest to diff against the portal later, rather than
 *      re-reading the TypeScript by eye.
 *
 * Usage:
 *   node scripts/steam-achievements.mjs            # human-readable table
 *   node scripts/steam-achievements.mjs --check    # validate only, exit 1 on problems
 *   node scripts/steam-achievements.mjs --json     # machine-readable manifest
 *   node scripts/steam-achievements.mjs --icons    # the icon checklist
 *
 * The JSON output is the thing worth committing when you do the portal
 * entry: it records what Steam is *supposed* to contain, so a later
 * mismatch is a diff instead of an archaeology session.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(REPO_ROOT, "shared/src/achievements.ts");

/**
 * Steam's documented cap on achievement API name length. Names are also
 * restricted to ASCII alphanumerics and underscores in practice — the
 * portal accepts more, but the SDK's string handling and Valve's own
 * examples stick to that set, and there is no upside to finding the
 * edges here.
 */
const MAX_API_NAME = 44;
const API_NAME_PATTERN = /^[A-Z0-9_]+$/;

/**
 * Steam renders achievement display names and descriptions in fixed-width
 * UI (the overlay list, the store page, the community profile). Long
 * strings are truncated with an ellipsis rather than wrapped. These are
 * the points where truncation starts to bite; exceeding them is a
 * warning, not an error.
 */
const DISPLAY_NAME_SOFT_MAX = 45;
const DESCRIPTION_SOFT_MAX = 100;

/**
 * Parse the achievement definitions out of the TypeScript source.
 *
 * Reading the .ts directly with a regex rather than importing it keeps
 * this script dependency-free — `shared` is TypeScript with no build
 * step of its own, so importing would drag tsx/esbuild into a script
 * whose whole job is to be runnable from a cold checkout.
 *
 * The tradeoff is that this parser only understands the current literal
 * shape of the file. It asserts a plausible count at the end so a
 * refactor that breaks the assumption fails loudly instead of silently
 * reporting three achievements.
 */
function parseAchievements() {
  const src = readFileSync(SOURCE, "utf8");
  const body = src.slice(src.indexOf("export const ACHIEVEMENTS"));

  const out = [];
  const objectPattern = /\{\s*id:\s*"([^"]+)",([\s\S]*?)\n\s{2}\}/g;

  for (const match of body.matchAll(objectPattern)) {
    const [, id, rest] = match;
    const field = (name) => rest.match(new RegExp(`${name}:\\s*"([^"]*)"`))?.[1];
    const flag = (name) => rest.match(new RegExp(`${name}:\\s*(true|false)`))?.[1] === "true";
    const num = (name) => {
      const hit = rest.match(new RegExp(`${name}:\\s*(\\d+)`));
      return hit ? Number(hit[1]) : undefined;
    };

    out.push({
      id,
      steamKey: field("steamKey"),
      name: field("name"),
      description: field("description"),
      category: field("category"),
      tier: field("tier"),
      secret: flag("secret"),
      threshold: num("threshold"),
    });
  }

  if (out.length < 10) {
    throw new Error(
      `Parsed only ${out.length} achievements from ${SOURCE}. The file's shape probably ` +
        "changed — update the parser in scripts/steam-achievements.mjs.",
    );
  }
  return out;
}

/** @returns {{ errors: string[], warnings: string[] }} */
function validate(achievements) {
  const errors = [];
  const warnings = [];
  const seenKeys = new Map();

  for (const a of achievements) {
    const label = a.steamKey ?? a.id;

    if (!a.steamKey) {
      errors.push(`${a.id}: missing steamKey`);
      continue;
    }
    if (!API_NAME_PATTERN.test(a.steamKey)) {
      errors.push(`${label}: API name must match ${API_NAME_PATTERN} (upper snake case)`);
    }
    if (a.steamKey.length > MAX_API_NAME) {
      errors.push(`${label}: API name is ${a.steamKey.length} chars, max ${MAX_API_NAME}`);
    }
    if (seenKeys.has(a.steamKey)) {
      errors.push(`${label}: duplicate API name, already used by ${seenKeys.get(a.steamKey)}`);
    }
    seenKeys.set(a.steamKey, a.id);

    if (!a.name) errors.push(`${label}: missing display name`);
    if (!a.description) errors.push(`${label}: missing description`);

    if (a.name && a.name.length > DISPLAY_NAME_SOFT_MAX) {
      warnings.push(
        `${label}: display name is ${a.name.length} chars, Steam truncates around ${DISPLAY_NAME_SOFT_MAX}`,
      );
    }
    if (a.description && a.description.length > DESCRIPTION_SOFT_MAX) {
      warnings.push(
        `${label}: description is ${a.description.length} chars, Steam truncates around ${DESCRIPTION_SOFT_MAX}`,
      );
    }
  }

  return { errors, warnings };
}

function printTable(achievements) {
  const width = Math.max(...achievements.map((a) => (a.steamKey ?? "").length));
  console.log(`\n${achievements.length} achievements — Partner Portal entry sheet\n`);
  console.log("Set 'Hidden' on every row marked SECRET. Progress-stat rows need");
  console.log("a matching stat defined under Stats before the achievement will");
  console.log("show progress in the overlay.\n");

  for (const a of achievements) {
    const flags = [a.secret ? "SECRET" : null, a.threshold ? `progress:${a.threshold}` : null]
      .filter(Boolean)
      .join(" ");
    console.log(`${(a.steamKey ?? "??").padEnd(width)}  ${a.name}`);
    console.log(`${" ".repeat(width)}  ${a.description}${flags ? `  [${flags}]` : ""}`);
  }
}

function printIcons(achievements) {
  console.log(`\nIcon checklist — ${achievements.length * 2} files, 64x64 PNG each\n`);
  console.log("Steam requires a locked AND an unlocked icon per achievement.");
  console.log("Locked icons are conventionally the unlocked art desaturated");
  console.log("or silhouetted. Secret achievements still need both.\n");
  for (const a of achievements) {
    const slug = a.id;
    console.log(`  ${slug}-locked.png`);
    console.log(`  ${slug}-unlocked.png`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const achievements = parseAchievements();
  const { errors, warnings } = validate(achievements);

  for (const w of warnings) console.warn(`warning: ${w}`);
  for (const e of errors) console.error(`error: ${e}`);

  if (args.includes("--check")) {
    if (errors.length > 0) {
      console.error(`\n${errors.length} problem(s) would break Steam achievement unlocks.`);
      process.exit(1);
    }
    console.log(`ok: ${achievements.length} achievements valid for Steamworks`);
    return;
  }

  if (errors.length > 0) process.exitCode = 1;

  if (args.includes("--json")) {
    console.log(
      JSON.stringify(
        achievements.map((a) => ({
          apiName: a.steamKey,
          displayName: a.name,
          description: a.description,
          hidden: a.secret,
          progressStat: a.threshold ? { max: a.threshold } : null,
        })),
        null,
        2,
      ),
    );
    return;
  }

  if (args.includes("--icons")) {
    printIcons(achievements);
    return;
  }

  printTable(achievements);
}

main();
