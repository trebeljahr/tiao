#!/usr/bin/env node
/**
 * Scans TypeScript source files for exported function/const declarations
 * and registers file paths as link targets.
 *
 * Produces a JSON map: { "fn-name": { url, file, line, name } }
 *
 * Usage: node docs-site/scripts/generate-source-links.mjs
 * Output: docs-site/source-links.json
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, relative, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT = resolve(__dirname, "../source-links.json");

const GITHUB_BASE = "https://github.com/trebeljahr/tiao/blob/main";

// ─── Source files to scan for exported symbols ──────────────────────
const SOURCES = ["shared/src/tiao.ts", "client/src/lib/engine/tiao-engine.ts"];

// ─── Files to register as link targets (no line scanning) ───────────
// Key is the basename by default. If two files share a basename, use
// a prefix like "server/tests/api.test.ts" → key "api.test.ts".
const FILES = [
  // Test files — server
  "server/tests/tiaoCore.test.ts",
  "server/tests/tiaoCoreEdgeCases.test.ts",
  "server/tests/api.test.ts",
  "server/tests/authRoutes.test.ts",
  "server/tests/gameService.test.ts",
  "server/tests/gameServiceActions.test.ts",
  "server/tests/matchmakingEdgeCases.test.ts",
  "server/tests/boardHarness.ts",

  // Test files — client
  "client/src/App.test.tsx",
  "client/src/lib/computer-ai.test.ts",
  "client/src/lib/hooks/useLocalGame.test.tsx",
  "client/src/lib/hooks/useGamesIndex.test.ts",
  "client/src/lib/hooks/useComputerGame.test.tsx",
  "client/src/lib/hooks/useMultiplayerGame.test.ts",
  "client/src/lib/hooks/useMatchmakingData.test.ts",
  "client/src/lib/hooks/useSocialData.test.ts",

  // Test files — E2E
  "e2e/localTurns.spec.ts",
  "e2e/localGameFull.spec.ts",
  "e2e/computerGame.spec.ts",
  "e2e/rematch.spec.ts",
  "e2e/rematchDecline.spec.ts",
  "e2e/matchmaking.spec.ts",
  "e2e/auth.spec.ts",
  "e2e/spectator.spec.ts",
  "e2e/lobby.spec.ts",

  // Config files
  "server/package.json",
  "client/vitest.config.mts",
  "playwright.config.ts",

  // AI engine files
  "client/src/lib/engine/tiao-engine.ts",
  "client/src/lib/engine/tiao-engine.worker.ts",
  "client/src/lib/computer-ai.ts",
  "client/src/lib/hooks/useComputerGame.ts",
];

// Matches:  export function name(
//           export const name =
//           export class name
//           export type name =
//           export interface name
const EXPORT_RE = /^export\s+(?:function|const|class|type|interface)\s+(\w+)/;

function scan(filePath) {
  const abs = resolve(ROOT, filePath);
  const lines = readFileSync(abs, "utf-8").split("\n");
  const entries = {};

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(EXPORT_RE);
    if (m) {
      const name = m[1];
      const line = i + 1;
      entries[`fn-${name}`] = {
        url: `${GITHUB_BASE}/${filePath}#L${line}`,
        file: filePath,
        line,
        name,
      };
    }
  }

  return entries;
}

const allLinks = {};

// Scan source files for exported symbols
for (const src of SOURCES) {
  Object.assign(allLinks, scan(src));
}

// Register file-level links
const seenBasenames = new Set();
for (const filePath of FILES) {
  const abs = resolve(ROOT, filePath);
  if (!existsSync(abs)) {
    console.warn(`  ⚠ File not found, skipping: ${filePath}`);
    continue;
  }
  const base = basename(filePath);
  const key = `fn-${base}`;
  if (seenBasenames.has(base)) {
    console.warn(`  ⚠ Duplicate basename "${base}" — only the first entry for ${key} is kept`);
    continue;
  }
  seenBasenames.add(base);
  allLinks[key] = {
    url: `${GITHUB_BASE}/${filePath}`,
    file: filePath,
    line: 0,
    name: base,
  };
}

writeFileSync(OUT, JSON.stringify(allLinks, null, 2) + "\n");

const count = Object.keys(allLinks).length;
console.log(`Generated ${count} source links → ${relative(ROOT, OUT)}`);
