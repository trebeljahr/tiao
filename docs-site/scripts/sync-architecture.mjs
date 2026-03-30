/**
 * Syncs docs/ARCHITECTURE.md → docs-site/docs/architecture.md
 * so there is a single source of truth for architecture documentation.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, "../../docs/ARCHITECTURE.md");
const dest = resolve(__dirname, "../docs/architecture.md");

const FRONTMATTER = `---
sidebar_position: 3
title: Architecture
---

`;

const content = readFileSync(src, "utf-8");
writeFileSync(dest, FRONTMATTER + content, "utf-8");
console.log("[sync] docs/ARCHITECTURE.md → docs-site/docs/architecture.md");
