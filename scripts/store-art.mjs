#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
// Store artwork composed from the existing board palette and a legal recorded
// position. These are promotional graphics, never gameplay screenshots.
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(new URL("../client/package.json", import.meta.url));
const sharp = require("sharp");
sharp.concurrency(1);
const output = resolve(process.argv[2] || "build/store-media");
mkdirSync(output, { recursive: true });
const recording = JSON.parse(
  readFileSync(new URL("../client/src/components/public/heroGameRecording.json", import.meta.url)),
);
const stones = [];
let white = true;
for (const move of recording.moves) {
  if (move.type !== "place") break;
  stones.push({ ...move.position, white });
  white = !white;
}
const defs = `<defs><linearGradient id="wood" x2="1" y2="1"><stop stop-color="#ead0a0"/><stop offset="1" stop-color="#c49a61"/></linearGradient><radialGradient id="white" cx="35%" cy="25%" r="75%"><stop stop-color="#fffdf5"/><stop offset=".65" stop-color="#eee8d8"/><stop offset="1" stop-color="#bcb3a0"/></radialGradient><radialGradient id="black" cx="35%" cy="25%" r="75%"><stop stop-color="#555047"/><stop offset=".6" stop-color="#29261f"/><stop offset="1" stop-color="#12120f"/></radialGradient></defs>`;
const board = `<rect width="660" height="660" rx="18" fill="url(#wood)"/><g stroke="#705330" stroke-width="1" opacity=".65">${Array.from({ length: 19 }, (_, n) => `<path d="M42 ${42 + n * 32}H618M${42 + n * 32} 42V618"/>`).join("")}</g>${[3, 9, 15].flatMap((x) => [3, 9, 15].map((y) => `<circle cx="${42 + x * 32}" cy="${42 + y * 32}" r="3.3" fill="#705330"/>`)).join("")}${stones.map((s) => `<circle cx="${42 + s.x * 32 + 2}" cy="${42 + s.y * 32 + 4}" r="15" fill="#342318" opacity=".18"/><circle cx="${42 + s.x * 32}" cy="${42 + s.y * 32}" r="14.5" fill="url(#${s.white ? "white" : "black"})"/>`).join("")}`;
function logo(x, y, size, color = "#28170e") {
  return `<text x="${x}" y="${y}" font-family="Georgia,serif" font-size="${size}" fill="${color}" letter-spacing="-4">Tiao</text>`;
}
const specs = [
  ["google-play-feature", 1024, 500],
  ["steam-header", 920, 430],
  ["steam-small", 462, 174],
  ["steam-main", 1232, 706],
  ["steam-vertical", 748, 896],
  ["steam-library-capsule", 600, 900],
  ["steam-library-header", 920, 430],
  ["steam-library-hero", 3840, 1240],
  ["apple-header", 3840, 1646],
];
const manifest = [];
for (const [name, width, height] of specs) {
  const vertical = height > width;
  const hero = name === "steam-library-hero";
  const small = name === "steam-small";
  const side = vertical ? width * 0.94 : height * 1.12;
  const bx = vertical ? (width - side) / 2 : width - side * 0.94;
  const by = vertical ? height * 0.39 : (height - side) / 2;
  const title = hero
    ? ""
    : logo(
        width * (vertical ? 0.1 : 0.07),
        height * (vertical ? 0.29 : 0.6),
        Math.min(width * (vertical ? 0.4 : 0.32), height * (vertical ? 0.3 : 0.6)),
      );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defs}<rect width="${width}" height="${height}" fill="#f4eddd"/><g transform="translate(${hero ? width * 0.43 : bx} ${by}) rotate(${vertical ? 10 : 14} ${side / 2} ${side / 2}) scale(${side / 660})" opacity="${small ? 0.65 : 1}">${board}</g>${title}</svg>`;
  writeFileSync(resolve(output, `${name}.svg`), svg);
  await sharp(Buffer.from(svg))
    .flatten({ background: "#f4eddd" })
    .png()
    .toFile(resolve(output, `${name}.png`));
  manifest.push({
    name,
    width,
    height,
    kind: "promotional artwork from the existing board design",
    alpha: false,
  });
}
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="600" viewBox="0 0 1280 600">${logo(35, 465, 550, "#fff8e8")}</svg>`;
writeFileSync(resolve(output, "steam-library-logo.svg"), logoSvg);
await sharp(Buffer.from(logoSvg)).png().toFile(resolve(output, "steam-library-logo.png"));
await sharp(new URL("../desktop/build/icon.png", import.meta.url).pathname)
  .resize(512, 512)
  .flatten({ background: "#1c1510" })
  .png()
  .toFile(resolve(output, "google-play-icon.png"));
manifest.push(
  { name: "steam-library-logo", width: 1280, height: 600, alpha: true },
  { name: "google-play-icon", width: 512, height: 512, alpha: false },
);
writeFileSync(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${manifest.length} store graphics to ${output}`);
