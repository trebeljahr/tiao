/**
 * Remark plugin that resolves [fn-*] markdown reference links using
 * the generated source-links.json map.
 *
 * In markdown, authors write:
 *   [`placePiece`][fn-placePiece]
 *
 * MDX splits this into AST nodes like:
 *   text("[") → inlineCode("placePiece") → text("][fn-placePiece]")
 *
 * This plugin scans for that pattern and replaces the sequence with
 * a resolved link node.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { visit, SKIP } from "unist-util-visit";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LINKS_FILE = resolve(__dirname, "../source-links.json");

let linksMap = null;

function loadLinks() {
  if (linksMap) return linksMap;
  try {
    const raw = JSON.parse(readFileSync(LINKS_FILE, "utf-8"));
    linksMap = {};
    for (const [key, entry] of Object.entries(raw)) {
      linksMap[key] = entry.url;
    }
    return linksMap;
  } catch {
    return {};
  }
}

// Match "][fn-name]" possibly with trailing text
const CLOSE_REF = /^\]\[(fn-[\w.\-]+)\](.*)/s;

export default function remarkSourceLinks() {
  return (tree) => {
    const links = loadLinks();
    if (Object.keys(links).length === 0) return;

    visit(tree, (node) => {
      if (!node.children || node.children.length < 2) return;

      const children = node.children;
      let changed = false;

      // Scan children for the closing pattern: text node containing "][fn-*]"
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type !== "text") continue;

        const closeMatch = child.value.match(CLOSE_REF);
        if (!closeMatch) continue;

        const [, refId, afterRef] = closeMatch;
        const url = links[refId];
        if (!url) continue;

        // Scan backward for the opening "[" text node
        let openIdx = -1;
        for (let j = i - 1; j >= 0; j--) {
          if (children[j].type === "text" && children[j].value.endsWith("[")) {
            openIdx = j;
            break;
          }
        }

        if (openIdx < 0) continue;

        changed = true;
        const openNode = children[openIdx];
        const beforeBracket = openNode.value.slice(0, -1); // everything before "["

        // Collect link children: everything between openIdx+1 and i (exclusive)
        const linkChildren = children.slice(openIdx + 1, i);

        // Build replacement nodes
        const replacements = [];
        if (beforeBracket) {
          replacements.push({ type: "text", value: beforeBracket });
        }
        replacements.push({
          type: "link",
          url,
          title: null,
          children: linkChildren,
        });
        if (afterRef) {
          replacements.push({ type: "text", value: afterRef });
        }

        // Splice: remove from openIdx to i (inclusive), insert replacements
        children.splice(openIdx, i - openIdx + 1, ...replacements);

        // Restart scan from the replacement position
        i = openIdx + replacements.length - 1;
      }

      if (changed) {
        return SKIP; // don't recurse into replaced nodes
      }
    });
  };
}
