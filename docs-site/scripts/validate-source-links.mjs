#!/usr/bin/env node
/**
 * Validates that:
 * 1. Every function listed in source-links.json still exists in the source at the declared line.
 * 2. Every [fn-*] reference used in docs has a matching entry in source-links.json.
 *
 * Exit code 1 on any failure — intended to run in CI / docs:build.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DOCS_DIR = resolve(__dirname, "../docs");
const LINKS_FILE = resolve(__dirname, "../source-links.json");

let links;
try {
  links = JSON.parse(readFileSync(LINKS_FILE, "utf-8"));
} catch {
  console.error(
    "source-links.json not found. Run generate-source-links.mjs first.",
  );
  process.exit(1);
}

const errors = [];

// --- Check 1: every entry in source-links.json still matches source ---

for (const [key, entry] of Object.entries(links)) {
  const abs = resolve(ROOT, entry.file);

  // File-level entries (line 0) only need the file to exist
  if (entry.line === 0) {
    try {
      readFileSync(abs);
    } catch {
      errors.push(`${key}: file not found: ${entry.file}`);
    }
    continue;
  }

  let lines;
  try {
    lines = readFileSync(abs, "utf-8").split("\n");
  } catch {
    errors.push(`${key}: source file not found: ${entry.file}`);
    continue;
  }

  const lineIdx = entry.line - 1;
  if (lineIdx < 0 || lineIdx >= lines.length) {
    errors.push(
      `${key}: line ${entry.line} out of range in ${entry.file} (${lines.length} lines)`,
    );
    continue;
  }

  const sourceLine = lines[lineIdx];
  // Check that the function/const/class name appears on that line as an export
  const exportPattern = new RegExp(
    `^export\\s+(?:function|const|class|type|interface)\\s+${entry.name}\\b`,
  );
  if (!exportPattern.test(sourceLine)) {
    // Maybe the function moved — search for it
    const newIdx = lines.findIndex((l) => exportPattern.test(l));
    if (newIdx >= 0) {
      errors.push(
        `${key}: "${entry.name}" moved from line ${entry.line} to line ${newIdx + 1} in ${entry.file}. Re-run generate-source-links.mjs.`,
      );
    } else {
      errors.push(
        `${key}: "${entry.name}" not found at line ${entry.line} in ${entry.file} and not found elsewhere. Was it renamed or removed?`,
      );
    }
  }
}

// --- Check 2: every [fn-*] reference in docs has a matching entry ---

const FN_REF_RE = /\[fn-([\w.\-]+)\]/g;

function walkDir(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full));
    } else if (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) {
      files.push(full);
    }
  }
  return files;
}

for (const file of walkDir(DOCS_DIR)) {
  const content = readFileSync(file, "utf-8");
  const relPath = relative(ROOT, file);
  let match;
  while ((match = FN_REF_RE.exec(content)) !== null) {
    const ref = `fn-${match[1]}`;
    if (!(ref in links)) {
      errors.push(`${relPath}: references [${ref}] but no such entry exists in source-links.json`);
    }
  }
}

// --- Report ---

if (errors.length > 0) {
  console.error(`\nSource link validation failed (${errors.length} error(s)):\n`);
  for (const err of errors) {
    console.error(`  ✗ ${err}`);
  }
  console.error("");
  process.exit(1);
} else {
  console.log(`Source links validated: ${Object.keys(links).length} entries, all OK.`);
}
