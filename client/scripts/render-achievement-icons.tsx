/**
 * Emit the raw SVG markup for every achievement icon, in both locked
 * and unlocked states, as JSON on stdout.
 *
 * Exists so `scripts/steam-achievement-icons.mjs` can build Steam's
 * PNG icons from the *same* components the in-game achievements page
 * renders. Redrawing them for Steam would guarantee the two drift
 * apart, and the drift would be invisible until someone compared a
 * Steam overlay against the web app side by side.
 *
 * Lives in client/ rather than the repo-root scripts/ because module
 * resolution for react-dom is relative to the file, and the icon
 * components are a client concern.
 *
 * Run via tsx. Not imported by the app.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AchievementIcon } from "../src/components/AchievementIcon";

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
      createElement(AchievementIcon, { id, tier, unlocked: true, className: "" }),
    ),
    locked: renderToStaticMarkup(
      createElement(AchievementIcon, { id, tier, unlocked: false, className: "" }),
    ),
  };
}

process.stdout.write(JSON.stringify(out));
