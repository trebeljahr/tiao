#!/usr/bin/env node
/*
 * steam-achievement-icons — render the 60 PNG icons Steam wants.
 *
 * Steam requires a locked AND an unlocked icon for every achievement,
 * 64x64 PNG each. With 30 achievements that is 60 files, and they have
 * to be uploaded one at a time through the Partner Portal.
 *
 * The art is not invented here. `client/src/components/AchievementIcon.tsx`
 * already carries a bespoke hand-drawn icon for all 30 achievements plus
 * the tier colour scheme, and that component is what the in-game
 * achievements page renders. This script drives those same components
 * through react-dom/server and rasterises the result, so the Steam
 * overlay and the web app cannot show different art for the same
 * achievement.
 *
 * Usage:
 *   node scripts/steam-achievement-icons.mjs
 *   node scripts/steam-achievement-icons.mjs --out some/dir
 *   node scripts/steam-achievement-icons.mjs --svg     # keep the SVG sources too
 *
 * Output lands in `build/steam-achievement-icons/` (git-ignored) named
 * `<ACH_API_NAME>-unlocked.png` / `-locked.png`. Named by API name
 * rather than internal id so that when you are 40 rows into the Partner
 * Portal form, the filename matches the field you just typed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAchievements } from "./steam-achievements.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = join(REPO_ROOT, "client");
const TSX = join(REPO_ROOT, "server/node_modules/.bin/tsx");

const SIZE = 64;

/**
 * Icon geometry. The source components draw in a 24x24 viewBox; we
 * scale that up and centre it, leaving a margin so the artwork doesn't
 * collide with the tile's rounded corners.
 *
 * 42px of art in a 64px tile puts the 1.8-unit stroke at a little over
 * 3px. That reads as deliberately bold, which is what you want — Steam
 * renders these small in the overlay and achievement lists, and thin
 * strokes disappear there.
 */
const ART = 42;
const OFFSET = (SIZE - ART) / 2;
const SCALE = ART / 24;

/**
 * Two tile palettes rather than one.
 *
 * Unlocked icons sit on Tiao's parchment with the achievement's tier
 * colour. Locked icons sit on a dark tile with the muted colour the app
 * already uses for them. Keeping the muted icon on a light tile would
 * have been more consistent, but #a89a7e on parchment is barely legible
 * at 64px — and Steam shows locked achievements far more often than
 * unlocked ones, so that is the state that has to survive being small.
 *
 * The light/dark split also does real work: a wall of achievements
 * reads at a glance as "lit" versus "off".
 */
const TILES = {
  unlocked: { bg: "#f2e7d0", border: "#c9b894" },
  locked: { bg: "#2f2a24", border: "#4a4239" },
};

function parseArgs(argv) {
  const args = { out: join(REPO_ROOT, "build/steam-achievement-icons"), svg: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--svg") args.svg = true;
    else {
      console.error(`unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return args;
}

/**
 * Pull the drawing commands out of the component's own <svg> wrapper so
 * they can be re-hosted inside the tile. The wrapper carries `fill` and
 * `stroke-width` that the children inherit, so both have to be
 * reapplied to the <g> or every icon renders as a filled blob.
 */
function extractInner(svgMarkup) {
  const opening = svgMarkup.indexOf(">");
  const closing = svgMarkup.lastIndexOf("</svg>");
  if (opening === -1 || closing === -1) {
    throw new Error(`Unexpected SVG markup: ${svgMarkup.slice(0, 120)}`);
  }
  return svgMarkup.slice(opening + 1, closing);
}

function composeTile(inner, state) {
  const { bg, border } = TILES[state];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" rx="14" fill="${bg}"/>
  <rect x="0.75" y="0.75" width="${SIZE - 1.5}" height="${SIZE - 1.5}" rx="13.25" fill="none" stroke="${border}" stroke-width="1.5"/>
  <g transform="translate(${OFFSET} ${OFFSET}) scale(${SCALE})" fill="none" stroke-width="1.8">${inner}</g>
</svg>
`;
}

/**
 * Rasterise with whichever converter the machine has. rsvg-convert
 * (librsvg) is preferred — it is what most Linux CI images carry and it
 * handles stroke geometry cleanly at small sizes. ImageMagick is the
 * fallback. Neither is a repo dependency, so failing here is a setup
 * problem and says so.
 */
function resolveRasterizer() {
  const has = (cmd) => {
    try {
      execFileSync("/usr/bin/env", ["which", cmd], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };

  if (has("rsvg-convert")) {
    return (svg, png) =>
      execFileSync("rsvg-convert", ["-w", String(SIZE), "-h", String(SIZE), "-o", png, svg]);
  }
  if (has("magick")) {
    // Render at high density then downsample — ImageMagick rasterises
    // SVG at the document size first, so converting straight to 64px
    // produces visibly chunky strokes.
    return (svg, png) =>
      execFileSync("magick", [
        "-background",
        "none",
        "-density",
        "384",
        svg,
        "-resize",
        `${SIZE}x${SIZE}`,
        png,
      ]);
  }

  console.error("No SVG rasteriser found. Install one of:");
  console.error("  brew install librsvg      # provides rsvg-convert (preferred)");
  console.error("  brew install imagemagick  # provides magick");
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const achievements = parseAchievements();

  if (!existsSync(TSX)) {
    console.error(`tsx not found at ${TSX}`);
    console.error("Run `pnpm install` first — the renderer needs it to load the .tsx components.");
    process.exit(1);
  }

  const rasterize = resolveRasterizer();

  // One tsx process for all 60 renders. Spawning per icon would spend
  // more time starting node than drawing.
  const request = achievements.map((a) => ({ id: a.id, tier: a.tier }));
  const rendered = JSON.parse(
    execFileSync(
      TSX,
      [join(CLIENT, "scripts/render-achievement-icons.tsx"), JSON.stringify(request)],
      {
        cwd: CLIENT,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      },
    ),
  );

  mkdirSync(args.out, { recursive: true });

  let written = 0;
  const missingArt = [];

  for (const a of achievements) {
    const variants = rendered[a.id];
    if (!variants) {
      missingArt.push(a.id);
      continue;
    }

    for (const state of ["unlocked", "locked"]) {
      const svgPath = join(args.out, `${a.steamKey}-${state}.svg`);
      const pngPath = join(args.out, `${a.steamKey}-${state}.png`);

      writeFileSync(svgPath, composeTile(extractInner(variants[state]), state));
      rasterize(svgPath, pngPath);
      if (!args.svg) rmSync(svgPath);
      written++;
    }
  }

  if (missingArt.length > 0) {
    console.error(`error: no icon rendered for: ${missingArt.join(", ")}`);
    process.exitCode = 1;
  }

  console.log(`Wrote ${written} PNGs (${SIZE}x${SIZE}) to ${args.out}`);
  console.log("Upload in the Partner Portal under App Admin -> Community -> Achievements.");
}

main();
