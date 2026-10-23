#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
// Reproduce approved SVG masters without changing their layout when the homepage
// replay changes. These are promotional graphics, never gameplay screenshots.
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(new URL("../client/package.json", import.meta.url));
// Next already provides the platform-specific Sharp renderer used by the client.
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
sharp.concurrency(1);
const output = resolve(process.argv[2] || "build/store-media");
mkdirSync(output, { recursive: true });
const brandSources = ["./assets/tiao-icon.svg", "./assets/tiao-wordmark.svg"].map((path) => {
  const svg = readFileSync(new URL(path, import.meta.url), "utf8");
  const viewBox = svg.match(/viewBox="([^"]+)"/)[1];
  return {
    viewBox,
    body: svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>")),
  };
});
const wordmarkBounds = brandSources[1].viewBox.split(/\s+/).map(Number);
const wordmarkRatio = wordmarkBounds[2] / wordmarkBounds[3];
function brand(x, cy, size, maxWidth, small = false) {
  const ratio = small ? 0.9 : 0.86;
  const naturalWidth = size * (1.14 + ratio * wordmarkRatio);
  size *= Math.min(1, maxWidth / naturalWidth);
  const gap = size * 0.14;
  const nameHeight = size * ratio;
  const nameWidth = nameHeight * wordmarkRatio;
  const shapes = [
    [x, cy - size / 2, size, size],
    [x + size + gap, cy - nameHeight / 2, nameWidth, nameHeight],
  ];
  return brandSources
    .map(
      ({ viewBox, body }, i) =>
        `<svg x="${shapes[i][0]}" y="${shapes[i][1]}" width="${shapes[i][2]}" height="${shapes[i][3]}" viewBox="${viewBox}" fill="#28170e">${body}</svg>`,
    )
    .join("");
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
  const svg = readFileSync(new URL(`./assets/store-art/${name}.svg`, import.meta.url), "utf8");
  const hero = name === "steam-library-hero";
  writeFileSync(resolve(output, `${name}.svg`), svg);
  await sharp(Buffer.from(svg))
    .flatten({ background: "#f4eddd" })
    .png()
    .toFile(resolve(output, `${name}.png`));
  manifest.push({
    name,
    width,
    height,
    kind: "approved five-hop capture illustration from the existing board design",
    alpha: false,
    brand: hero
      ? "text-free background"
      : "existing framed SVG left of the website wordmark; outlined fonts",
  });
}
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="600" viewBox="0 0 1280 600">${brand(80, 300, 350, 1120)}</svg>`;
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
