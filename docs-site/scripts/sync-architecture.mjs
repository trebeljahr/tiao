/**
 * Syncs docs/ARCHITECTURE.md → docs-site/docs/architecture.md
 * so there is a single source of truth for architecture documentation.
 *
 * Edit docs/ARCHITECTURE.md, never the docs-site copy: every build
 * overwrites it. The sync adds the Docusaurus frontmatter and rewrites
 * links to other repo files so they resolve on the docs site.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "../../docs");
const src = resolve(srcDir, "ARCHITECTURE.md");
const dest = resolve(__dirname, "../docs/architecture.md");

const FRONTMATTER = `---
sidebar_position: 3
title: Architecture
description: System architecture for Tiao contributors, covering the shared game engine, server layer, client app, realtime protocol, and deployment model.
---

`;

/** Repo docs (relative to docs/) that have their own page on the docs site. */
const SITE_PAGES = {
  "GAME_RULES.md": "game-rules.md",
  "TESTING.md": "testing.md",
  "DEPLOYMENT.md": "deployment.md",
};

const REPO_BLOB_URL = "https://github.com/trebeljahr/tiao/blob/main/";

/**
 * Rewrites one Markdown link target. Absolute URLs and in-page anchors stay
 * as they are. A repo doc with a docs-site page links to that page; any other
 * repo file links to GitHub, because the docs site does not publish it.
 */
function rewriteTarget(target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("/")) {
    return target;
  }
  const hashIndex = target.indexOf("#");
  const path = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : target.slice(hashIndex);
  const normalized = posix.normalize(path);

  if (SITE_PAGES[normalized]) return SITE_PAGES[normalized] + hash;
  if (!existsSync(resolve(srcDir, normalized))) {
    throw new Error(`[sync] docs/ARCHITECTURE.md links to missing file: ${target}`);
  }
  return REPO_BLOB_URL + posix.join("docs", normalized) + hash;
}

const content = readFileSync(src, "utf-8").replace(
  /\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g,
  (_match, target, title) => `](${rewriteTarget(target)}${title})`,
);

writeFileSync(dest, FRONTMATTER + content, "utf-8");
console.log("[sync] docs/ARCHITECTURE.md → docs-site/docs/architecture.md");
