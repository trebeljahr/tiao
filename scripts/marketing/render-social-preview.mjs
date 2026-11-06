#!/usr/bin/env node
// Render the GitHub social preview cards (1280×640 PNG, under 1 MB) from
// docs/marketing/social-preview/template.html: A screenshot-led, B brand-led,
// C dark with desktop and phone. Run `pnpm marketing:screenshots` first; the
// cards use those screenshots.
//
//   pnpm marketing:social
//   pnpm marketing:social --review-dir /some/folder   # also copy the cards and a labelled review-sheet.jpg there
//
// Serves the repo root on 127.0.0.1 at a free port in 49152–65535 so the
// template can load the website fonts and SVGs, then stops it.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { updateManifest } from "./manifest.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cardDir = resolve(repoRoot, "docs/marketing/social-preview");
const args = process.argv.slice(2);
const reviewIndex = args.indexOf("--review-dir");
const reviewDir = reviewIndex >= 0 ? resolve(args[reviewIndex + 1]) : null;

export const variants = [
  ["a", "Screenshot-led: brand, headline and a real capture-chain board crop on cream"],
  ["b", "Brand-led: large icon and wordmark, rules in one line, tilted board crop fading in"],
  ["c", "Dark: brand on the night palette with a desktop game review and a phone capture"],
];

const types = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = createServer((req, res) => {
  const path = resolve(repoRoot, `.${decodeURIComponent(new URL(req.url, "http://x").pathname)}`);
  if (!path.startsWith(repoRoot + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = readFileSync(path);
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});

async function listen() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = 49152 + Math.floor(Math.random() * (65535 - 49152));
    let busy = false;
    try {
      execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { stdio: "ignore" });
      busy = true;
    } catch {}
    if (busy) continue;
    const ok = await new Promise((done) => {
      server.once("error", () => done(false));
      server.listen(port, "127.0.0.1", () => done(true));
    });
    if (ok) return port;
  }
  throw new Error("No free port in 49152–65535 after 3 tries");
}

const port = await listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--mute-audio"],
});
const entries = [];
const today = new Date().toISOString().slice(0, 10);
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: 1,
  });
  const failed = [];
  page.on("requestfailed", (r) => failed.push(r.url()));
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  for (const [variant, purpose] of variants) {
    await page.goto(
      `http://127.0.0.1:${port}/docs/marketing/social-preview/template.html?variant=${variant}`,
      { waitUntil: "networkidle" },
    );
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() =>
      [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
    );
    if (!fonts.some((f) => f.includes("Zen Old Mincho")))
      throw new Error(`Variant ${variant}: website fonts did not load`);
    if (failed.length) throw new Error(`Variant ${variant}: failed requests\n${failed.join("\n")}`);
    const file = resolve(cardDir, `social-preview-${variant}.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1280, height: 640 } });
    // GitHub limits the social preview to 1 MB; quantise if the PNG is larger.
    if (statSync(file).size > 1_000_000)
      execFileSync("magick", [file, "-colors", "256", "-define", "png:compression-level=9", file]);
    entries.push({
      path: relative(resolve(repoRoot, "docs/marketing"), file),
      variant: variant.toUpperCase(),
      purpose,
      width: 1280,
      height: 640,
      bytes: statSync(file).size,
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
      made: "social-preview/template.html rendered by scripts/marketing/render-social-preview.mjs (Playwright Chromium)",
      date: today,
    });
    console.log(`social-preview-${variant}.png ${Math.round(statSync(file).size / 1024)} KB`);
  }
  if (reviewDir) {
    mkdirSync(reviewDir, { recursive: true });
    for (const [variant] of variants)
      copyFileSync(
        resolve(cardDir, `social-preview-${variant}.png`),
        resolve(reviewDir, `social-preview-${variant}.png`),
      );
    // All iterations side by side at full size, each labelled with its letter.
    const cards = variants
      .map(
        ([variant, purpose]) =>
          `<figure><figcaption><b>${variant.toUpperCase()}</b> ${purpose}</figcaption><img src="/docs/marketing/social-preview/social-preview-${variant}.png"></figure>`,
      )
      .join("");
    await page.setViewportSize({ width: 3 * 1280 + 4 * 48, height: 640 + 200 });
    await page.goto(
      `http://127.0.0.1:${port}/docs/marketing/social-preview/template.html?variant=none`,
    );
    await page.evaluate((html) => {
      document.documentElement.style.cssText = "width:auto;height:auto";
      document.body.style.cssText =
        "width:auto;height:auto;display:flex;gap:48px;padding:48px;background:#e6dcc8;font-family:'Zen Kaku Gothic New';color:#28170e";
      document.body.innerHTML = html;
      for (const f of document.querySelectorAll("figure"))
        f.style.cssText = "margin:0;width:1280px";
      for (const c of document.querySelectorAll("figcaption"))
        c.style.cssText = "font-size:34px;line-height:1.3;height:96px";
      for (const b of document.querySelectorAll("figcaption b"))
        b.style.cssText = "font-size:44px;margin-right:12px";
      for (const i of document.querySelectorAll("img"))
        i.style.cssText =
          "display:block;width:1280px;height:640px;box-shadow:0 8px 30px rgba(40,23,14,.25)";
    }, cards);
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: resolve(reviewDir, "review-sheet.jpg"),
      type: "jpeg",
      quality: 85,
      fullPage: true,
    });
    console.log(`Review copies: ${reviewDir}`);
  }
} finally {
  await browser.close();
  server.close();
}
updateManifest("socialPreview", entries);
