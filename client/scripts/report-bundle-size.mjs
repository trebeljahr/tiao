#!/usr/bin/env node

// Run after a production build: pnpm size [out|.next-desktop|.next-mobile].
// Export size is disk use; initial resources are transfer estimates (gzip).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { listFiles } from "./finalize-web-export.mjs";

const out = resolve(process.argv[2] || "out");
if (!existsSync(join(out, "_next", "static"))) {
  throw new Error(`No static export at ${out}. Run a production build first.`);
}

const files = listFiles(out);
const bytes = (file) => statSync(join(out, file)).size;
const sum = (paths) => paths.reduce((total, file) => total + bytes(file), 0);
const kib = (size) => `${(size / 1024).toFixed(1)} KiB`;

console.log(`Export: ${out}`);
for (const [label, paths] of [
  ["Total (all routes/locales, including carried releases)", files],
  ["HTML", files.filter((file) => file.endsWith(".html"))],
  ["RSC / route payloads", files.filter((file) => file.endsWith(".txt"))],
  ["JavaScript (including lazy chunks)", files.filter((file) => file.endsWith(".js"))],
])
  console.log(`${label}: ${kib(sum(paths))}`);

console.log("\nInitial HTML + script/preload resources (gzip estimates; excludes later requests):");
for (const file of [
  "index.html",
  "local.html",
  "de/local.html",
  "es/local.html",
  "en/local/index.html",
  "de/local/index.html",
  "es/local/index.html",
]) {
  if (!existsSync(join(out, file))) continue;
  const html = readFileSync(join(out, file), "utf8");
  const scripts = new Set(
    [...html.matchAll(/(?:src|href)="([^"?]+\.js)"/g)]
      .map((match) => decodeURIComponent(match[1]))
      .filter((url) => url.startsWith("/_next/"))
      .map((url) => url.slice(1)),
  );
  const scriptGzip = [...scripts].reduce(
    (total, script) => total + gzipSync(readFileSync(join(out, script)), { level: 9 }).length,
    0,
  );
  const htmlGzip = gzipSync(html, { level: 9 }).length;
  console.log(
    `${file}: HTML ${kib(htmlGzip)}, JS ${kib(scriptGzip)}, combined ${kib(htmlGzip + scriptGzip)}`,
  );
}
