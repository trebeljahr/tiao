#!/usr/bin/env node
/*
 * Export Steam achievement icons from the selected open-line PNG masters.
 * The default validates scripts/assets/achievement-icons/manifest.json and
 * renders 256px/64px unlocked and grayscale locked files. bulk/ uses Steam's
 * API_NAME_ACHIEVED / API_NAME_UNACHIEVED naming. ImageMagick is required.
 *
 * node scripts/steam-achievement-icons.mjs [--out directory]
 * node scripts/steam-achievement-icons.mjs --source app [--svg]
 *
 * --source app preserves the legacy renderer of the in-game SVG component.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAchievements } from "./steam-achievements.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = join(REPO_ROOT, "client");
const TSX = join(REPO_ROOT, "server/node_modules/.bin/tsx");

/**
 * The tile is always composed in a 64-unit coordinate space and
 * rasterised at whatever pixel size is asked for. The source art is
 * vector, so a larger render costs nothing and loses nothing.
 */
const VIEWBOX = 64;

/**
 * Steam stores achievement icons at 256x256 and downscales to 64x64 for
 * the achievement lists, so uploading at 64 throws away detail that
 * Big Picture and Deck would otherwise use. 256 is what goes to the
 * portal; the 64 set is kept as a fallback in case an upload form
 * rejects the larger file.
 */
const SIZES = [256, 64];

/**
 * Icon geometry, in the 64-unit tile space. 42 units of art leaves a
 * margin so the drawing doesn't collide with the rounded corners, and
 * puts the 1.8-unit stroke at a little over 3 units — deliberately
 * bold, because Steam renders these small in the overlay and thin
 * strokes disappear there.
 */
const ART = 42;
const OFFSET = (VIEWBOX - ART) / 2;
const SCALE = ART / 24;

/**
 * The muted colour AchievementIcon uses for its locked state. Replaced
 * with a neutral grey below — see LOCKED_INK.
 */
const APP_MUTED = "#a89a7e";

/**
 * Locked icons are greyscale, which is the near-universal convention on
 * Steam: the locked and unlocked art should read as two states of one
 * icon, so only the colour changes. Valve does not enforce this — it
 * does not generate the locked variant for you either, whatever you
 * upload is what players see — but breaking the convention makes a
 * locked achievement look like a different achievement rather than an
 * unearned one.
 *
 * The app's own muted tan (#a89a7e) is carried over as a flat grey
 * rather than kept, because it is a colour, and because at 64px on a
 * pale tile it is barely legible. #808080 on #e7e7e7 holds about 3.2:1,
 * which a 3-unit stroke reads fine at.
 */
const LOCKED_INK = "#808080";

const TILES = {
  unlocked: { bg: "#f2e7d0", border: "#c9b894" },
  locked: { bg: "#e7e7e7", border: "#bdbdbd" },
};

function parseArgs(argv) {
  const args = {
    out: join(REPO_ROOT, "build/steam-achievement-icons"),
    svg: false,
    source: "curated",
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--svg") args.svg = true;
    else if (argv[i] === "--source") args.source = argv[++i];
    else {
      console.error(`unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  if (!["curated", "app"].includes(args.source)) throw new Error("--source must be curated or app");
  if (args.svg && args.source !== "app")
    throw new Error("SVG sources require --source app --svg; curated masters are PNG files.");
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
  // The component hands back its locked variant already coloured with
  // the app's muted tan. Swapping the hex here keeps AchievementIcon as
  // the single source of shape while letting Steam have the greyscale
  // treatment its UI expects.
  const ink = state === "locked" ? inner.split(APP_MUTED).join(LOCKED_INK) : inner;

  // Square, not rounded. Steam stores achievement icons as JPEG, which
  // has no alpha channel — rounded corners would composite against the
  // matte and show as a bright halo on Steam's dark achievement lists.
  // Steam draws its own rounded frames around these anyway.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEWBOX}" height="${VIEWBOX}" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">
  <rect width="${VIEWBOX}" height="${VIEWBOX}" fill="${bg}"/>
  <rect x="0.75" y="0.75" width="${VIEWBOX - 1.5}" height="${VIEWBOX - 1.5}" fill="none" stroke="${border}" stroke-width="1.5"/>
  <g transform="translate(${OFFSET} ${OFFSET}) scale(${SCALE})" fill="none" stroke-width="1.8">${ink}</g>
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
    return (svg, png, size) =>
      execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", png, svg]);
  }
  if (has("magick")) {
    // Render at high density then downsample — ImageMagick rasterises
    // SVG at the document size first, so converting straight to 64px
    // produces visibly chunky strokes.
    return (svg, png, size) =>
      execFileSync("magick", [
        "-background",
        "none",
        "-density",
        String(size * 6),
        svg,
        "-resize",
        `${size}x${size}`,
        png,
      ]);
  }

  console.error("No SVG rasteriser found. Install one of:");
  console.error("  brew install librsvg      # provides rsvg-convert (preferred)");
  console.error("  brew install imagemagick  # provides magick");
  process.exit(1);
}

/**
 * Flatten a rendered PNG to JPG. The tiles are fully opaque, so there
 * is no alpha to lose — but JPG has no alpha at all, and a transparent
 * source would composite against black and ruin the artwork, so the
 * white matte is set explicitly rather than left to chance.
 */
function toJpeg(png, jpg) {
  execFileSync("magick", [png, "-background", "white", "-flatten", "-quality", "92", jpg]);
}

function renderCurated(args, achievements) {
  const sourceDir = join(REPO_ROOT, "scripts/assets/achievement-icons");
  const manifest = JSON.parse(readFileSync(join(sourceDir, "manifest.json"), "utf8"));
  if (!Array.isArray(manifest.icons) || manifest.icons.length !== achievements.length) {
    throw new Error("Curated artwork must contain exactly one master for every achievement");
  }
  const byId = new Map(manifest.icons.map((icon) => [icon.id, icon]));
  if (byId.size !== achievements.length) throw new Error("Duplicate curated achievement IDs");
  for (const achievement of achievements) {
    const icon = byId.get(achievement.id);
    if (!icon || icon.steamKey !== achievement.steamKey || icon.tier !== achievement.tier) {
      throw new Error(`Curated artwork mapping mismatch: ${achievement.id}`);
    }
    const bytes = readFileSync(join(sourceDir, icon.master));
    if (createHash("sha256").update(bytes).digest("hex") !== icon.sha256) {
      throw new Error(`Curated artwork checksum mismatch: ${achievement.id}`);
    }
  }
  const env = { ...process.env, MAGICK_THREAD_LIMIT: "1", OMP_NUM_THREADS: "1" };
  const bulk = join(args.out, "bulk");
  mkdirSync(bulk, { recursive: true });
  for (const size of SIZES) mkdirSync(join(args.out, `${size}x${size}`), { recursive: true });
  for (const achievement of achievements) {
    const icon = byId.get(achievement.id);
    for (const state of ["unlocked", "locked"]) {
      for (const size of SIZES) {
        const dir = join(args.out, `${size}x${size}`);
        const png = join(dir, `${achievement.steamKey}-${state}.png`);
        const transform = state === "locked" ? ["-colorspace", "Gray", "-colorspace", "sRGB"] : [];
        execFileSync(
          "magick",
          [
            "-limit",
            "thread",
            "1",
            "-limit",
            "memory",
            "128MiB",
            join(sourceDir, icon.master),
            "-resize",
            `${size}x${size}`,
            "-background",
            "white",
            "-gravity",
            "center",
            "-extent",
            `${size}x${size}`,
            "-alpha",
            "remove",
            "-alpha",
            "off",
            ...transform,
            "-strip",
            png,
          ],
          { env },
        );
        toJpeg(png, join(dir, `${achievement.steamKey}-${state}.jpg`));
        if (size === 256) {
          const suffix = state === "unlocked" ? "ACHIEVED" : "UNACHIEVED";
          copyFileSync(png, join(bulk, `${achievement.steamKey}_${suffix}.png`));
        }
      }
    }
  }
  console.log(
    `Exported ${achievements.length} curated achievements in both states; bulk PNGs: ${bulk}`,
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const achievements = parseAchievements();
  if (args.source === "curated") {
    renderCurated(args, achievements);
    return;
  }

  if (!existsSync(TSX)) {
    console.error(`tsx not found at ${TSX}`);
    console.error("Run `pnpm install` first — the renderer needs it to load the .tsx components.");
    process.exit(1);
  }

  const rasterize = resolveRasterizer();

  // JPG is what Valve asks for, but it needs ImageMagick. Missing it
  // degrades to PNG-only rather than failing — the endpoint takes both.
  let canJpeg = true;
  try {
    execFileSync("/usr/bin/env", ["which", "magick"], { stdio: "ignore" });
  } catch {
    canJpeg = false;
    console.warn("warning: magick not found — writing PNG only (Valve's docs ask for JPG)");
  }

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

  let written = 0;
  const missingArt = [];

  for (const size of SIZES) {
    mkdirSync(join(args.out, `${size}x${size}`), { recursive: true });
  }

  for (const a of achievements) {
    const variants = rendered[a.id];
    if (!variants) {
      missingArt.push(a.id);
      continue;
    }

    for (const state of ["unlocked", "locked"]) {
      const svg = composeTile(extractInner(variants[state]), state);

      for (const size of SIZES) {
        const dir = join(args.out, `${size}x${size}`);
        const svgPath = join(dir, `${a.steamKey}-${state}.svg`);
        const pngPath = join(dir, `${a.steamKey}-${state}.png`);

        writeFileSync(svgPath, svg);
        rasterize(svgPath, pngPath, size);
        if (!args.svg) rmSync(svgPath);
        written++;

        if (canJpeg) {
          toJpeg(pngPath, join(dir, `${a.steamKey}-${state}.jpg`));
          written++;
        }
      }
    }
  }

  if (missingArt.length > 0) {
    console.error(`error: no icon rendered for: ${missingArt.join(", ")}`);
    process.exitCode = 1;
  }

  console.log(`Wrote ${written} files to ${args.out}`);
  for (const size of SIZES) {
    console.log(
      `  ${size}x${size}/  ${achievements.length * 2} icons${canJpeg ? " (.jpg + .png)" : " (.png)"}`,
    );
  }
  console.log("Upload the 256x256 set — Steam stores that and downscales for the lists.");
}

main();
