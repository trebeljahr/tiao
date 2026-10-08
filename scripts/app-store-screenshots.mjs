#!/usr/bin/env node
// Every App Store screenshot set in one run: gameplay and UI scenes at each
// Apple size in scripts/store-sizes.mjs (iPhone 6.9", 6.5", iPhone Duo outer
// and inner, 13" iPad, Mac). Output: output/playwright/store-*/<size>/*.jpg.
//
//   node scripts/app-store-screenshots.mjs http://localhost:<port> [--only=ipad-13,mac]
//
// Start an isolated local client first (no API needed: gameplay is local and
// the UI scenes use sample data). Check sizes with `sips -g pixelWidth -g
// pixelHeight` before uploading; App Store Connect rejects any other size.
import { execFileSync } from "node:child_process";
import { storeSizes } from "./store-sizes.mjs";

const baseURL = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(baseURL ?? "")) {
  throw new Error("Pass the isolated local client URL, e.g. http://localhost:51234");
}
const only = process.argv
  .find((arg) => arg.startsWith("--only="))
  ?.slice(7)
  .split(",");
const sizes = Object.entries(storeSizes)
  .filter(([name, size]) => size.ascType && (!only || only.includes(name)))
  .map(([name]) => name);
if (!sizes.length) throw new Error("No App Store sizes selected");

for (const name of sizes) {
  for (const script of ["scripts/store-screenshots.mjs", "scripts/store-ui-screenshots.mjs"]) {
    console.log(`\n== ${name}: ${script}`);
    execFileSync(process.execPath, [script, baseURL, `--size=${name}`], { stdio: "inherit" });
  }
}
console.log(`\nDone: ${sizes.join(", ")}`);
