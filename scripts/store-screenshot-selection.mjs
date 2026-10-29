// The upload order is deliberate: three stages of play, plus the surrounding game.
// Keep the raw captures for editors; this is the compact store/press selection.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

export const screenshotSelection = [
  ["store-gameplay", "02-ai-capture-chain", "An AI capture chain"],
  ["store-ui", "11-tutorial-chain", "Interactive chain-jump tutorial"],
  ["store-ui", "13-achievements", "Achievements"],
  ["store-gameplay", "00-ai-developed-position", "A developed AI game"],
  ["store-ui", "14-computer-setup", "Computer difficulty and game setup"],
  ["store-ui", "07-tournament-bracket", "Tournament bracket"],
  ["store-ui", "08-friends", "Friends and invitations"],
  ["store-ui", "15-board-themes", "Board themes and navigation"],
  ["store-ui", "10-game-review", "Review a capture with replay controls"],
  ["store-gameplay", "05-ai-victory", "AI match victory"],
];

export function selectScreenshots(size) {
  const output = resolve("output/playwright/store-overview", size.name);
  mkdirSync(output, { recursive: true });
  // Read every input before updating the selection: a missing capture must fail loudly.
  const captures = screenshotSelection.map(([folder, scene, title], index) => {
    const source = resolve(
      "output/playwright",
      folder,
      ...(size.store ? [size.name] : []),
      `${scene}.${size.ext}`,
    );
    const bytes = readFileSync(source);
    const hasGameBoard =
      folder === "store-gameplay" || ["10-game-review", "15-board-themes"].includes(scene);
    const gameplay = hasGameBoard
      ? JSON.parse(readFileSync(resolve(source, "..", "capture-provenance.json"), "utf8"))[scene]
      : null;
    if (hasGameBoard) {
      assert(
        gameplay?.ledgerSha256 && gameplay.completedDecisions >= 20,
        `Missing AI provenance: ${scene}`,
      );
      assert.equal(
        createHash("sha256").update(readFileSync(gameplay.ledger)).digest("hex"),
        gameplay.ledgerSha256,
        "AI ledger changed after capture",
      );
    }
    return {
      file: `${String(index + 1).padStart(2, "0")}-${scene.slice(3)}.${size.ext}`,
      title,
      source,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      kind: gameplay
        ? "shipped AI self-play rendered through actual game UI"
        : "shipped UI with isolated sample account data",
      ...(gameplay ? { gameplay } : {}),
    };
  });
  // A reordered selection must not leave older numbered images in the upload folder.
  for (const file of readdirSync(output)) {
    if (/^\d{2}-.+\.(png|jpg)$/.test(file)) unlinkSync(resolve(output, file));
  }
  for (const capture of captures) copyFileSync(capture.source, resolve(output, capture.file));
  writeFileSync(
    resolve(output, "selection.json"),
    `${JSON.stringify(
      {
        size: size.name,
        width: size.width,
        height: size.height,
        publication: "Local selection; not uploaded or published",
        captures: captures.map(({ source, ...capture }) => ({
          ...capture,
          source: source.slice(process.cwd().length + 1),
        })),
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    resolve(output, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Tiao screenshot overview</title>
<style>body{margin:32px;background:#eee4d2;color:#32281e;font:16px system-ui}h1{font-size:24px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}figure{margin:0}img{width:100%;display:block}figcaption{padding:8px 0}a{color:inherit}</style>
<h1>Tiao — ${size.name}</h1><p>Local captures. Sample accounts. Not published.</p><main>${captures.map((capture, i) => `<figure><a href="${capture.file}"><img src="${capture.file}" alt="${capture.title}"></a><figcaption>${i + 1}. ${capture.title}</figcaption></figure>`).join("\n")}</main>`,
  );
  console.log(`Selected ${captures.length} screenshots: ${output}`);
  return output;
}
