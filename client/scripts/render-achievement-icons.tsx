/**
 * Emit the raw SVG markup for every achievement icon, in both locked
 * and unlocked states, as JSON on stdout.
 *
 * Preserves the original SVG set for the Steam exporter's optional
 * --source app mode. Production UI uses the selected raster artwork.
 *
 * Lives in client/ rather than the repo-root scripts/ because module
 * resolution for react-dom is relative to the file, and the icon
 * components are a client concern.
 *
 * Run via tsx. Not imported by the app.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LegacyAchievementIcon } from "./LegacyAchievementIcon";

type Tier = "bronze" | "silver" | "gold" | "platinum";
type Request = { id: string; tier: Tier };

// The achievement list arrives as JSON on argv so this script doesn't
// need its own parser for shared/src/achievements.ts — the .mjs
// orchestrator already has one.
const requests: Request[] = JSON.parse(process.argv[2] ?? "[]");

const out: Record<string, { locked: string; unlocked: string }> = {};

for (const { id, tier } of requests) {
  out[id] = {
    unlocked: renderToStaticMarkup(
      createElement(LegacyAchievementIcon, { id, tier, unlocked: true, className: "" }),
    ),
    locked: renderToStaticMarkup(
      createElement(LegacyAchievementIcon, { id, tier, unlocked: false, className: "" }),
    ),
  };
}

process.stdout.write(JSON.stringify(out));
