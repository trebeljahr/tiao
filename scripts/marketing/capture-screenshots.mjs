#!/usr/bin/env node
// Screenshots for the README, the GitHub social preview and press, written to
// docs/marketing/screenshots/ with their entries in docs/marketing/manifest.json.
//
// Capture reuses the store pipeline (scripts/app-store-screenshots.mjs):
// shipped-AI self-play replayed through the real local-game UI, plus UI scenes
// served with isolated sample API data. No production accounts, no backend.
// Sizes: `mac` (1440×900 CSS px at 2×) and `iphone-69` (440×956 at 3×).
//
//   pnpm marketing:screenshots                      # start a client, capture, export
//   pnpm marketing:screenshots --url http://127.0.0.1:51234   # reuse a running client
//   pnpm marketing:screenshots --export-only        # re-export existing captures
//
// Needs client dependencies (`pnpm --dir client install`) and ImageMagick
// (`magick`) for the JPEG export. Set CHROMIUM_PATH to reuse a cached Chromium.
// The client this script starts listens on a free port in 49152–65535 and is
// stopped on exit; nothing else is touched.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { updateManifest } from "./manifest.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(repoRoot);
const outDir = resolve("docs/marketing/screenshots");
const overview = resolve("output/playwright/store-overview");

// [output file, store size, selection file, purpose]
export const marketingScreenshots = [
  [
    "desktop-capture-chain.jpg",
    "mac",
    "01-ai-capture-chain.jpg",
    "README hero; social preview A, B",
  ],
  ["desktop-tutorial-chain.jpg", "mac", "02-tutorial-chain.jpg", "README rules section"],
  [
    "desktop-game-review.jpg",
    "mac",
    "09-game-review.jpg",
    "README rules section; social preview C",
  ],
  ["desktop-computer-setup.jpg", "mac", "05-computer-setup.jpg", "press and posts"],
  [
    "mobile-capture-chain.jpg",
    "iphone-69",
    "01-ai-capture-chain.jpg",
    "README apps section; social preview C",
  ],
  ["mobile-game-review.jpg", "iphone-69", "09-game-review.jpg", "press and posts"],
];

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function isPortFree(port) {
  return new Promise((done) => {
    const srv = createServer();
    srv.once("error", () => done(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => done(true)));
  });
}

function lsofBusy(port) {
  try {
    execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function freePort() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = 49152 + Math.floor(Math.random() * (65535 - 49152));
    if (!lsofBusy(port) && (await isPortFree(port))) return port;
  }
  throw new Error("No free port in 49152–65535 after 3 tries");
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
}

async function startClient() {
  const port = await freePort();
  const apiPort = await freePort();
  // client/server.mjs is `next dev` plus the API proxy. The capture scripts
  // answer every /api request inside the browser, so no backend runs.
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: resolve("client"),
    env: {
      ...process.env,
      PORT: String(port),
      API_PORT: String(apiPort),
      HATCHKIT_LOCAL_DEV: "0",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  const stop = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  };
  process.on("exit", stop);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stop();
      process.exit(1);
    });
  const url = `http://127.0.0.1:${port}`;
  console.log(`Client: ${url} (pid ${child.pid})`);
  await waitForHttp(`${url}/en`, 240_000);
  return { url, stop };
}

function capture(url) {
  execFileSync(
    process.execPath,
    ["scripts/app-store-screenshots.mjs", url, "--only=mac,iphone-69"],
    { stdio: "inherit" },
  );
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function exportScreenshots() {
  mkdirSync(outDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const entries = [];
  for (const [file, size, source, purpose] of marketingScreenshots) {
    const from = resolve(overview, size, source);
    if (!existsSync(from)) throw new Error(`Missing capture ${from}; run without --export-only`);
    const selection = JSON.parse(readFileSync(resolve(overview, size, "selection.json"), "utf8"));
    const picked = selection.captures.find((c) => c.file === source);
    const to = resolve(outDir, file);
    execFileSync("magick", [
      from,
      "-strip",
      "-interlace",
      "Plane",
      "-sampling-factor",
      "4:2:0",
      "-quality",
      "84",
      to,
    ]);
    const [width, height] = execFileSync("magick", ["identify", "-format", "%w %h", to], {
      encoding: "utf8",
    })
      .trim()
      .split(" ")
      .map(Number);
    entries.push({
      path: relative(resolve("docs/marketing"), to),
      title: picked?.title ?? source,
      purpose,
      width,
      height,
      bytes: statSync(to).size,
      sha256: sha256(to),
      made: `Real app capture (${size} store size) by scripts/app-store-screenshots.mjs; ${picked?.kind ?? "store selection"}. Re-encoded as JPEG q84 by scripts/marketing/capture-screenshots.mjs.`,
      source: `output/playwright/store-overview/${size}/${source}`,
      sourceSha256: sha256(from),
      ...(picked?.gameplay
        ? {
            gameplay: Object.fromEntries(
              [
                "ledger",
                "ledgerSha256",
                "completedDecisions",
                "boardSize",
                "scoreToWin",
                "score",
              ].map((key) => [key, picked.gameplay[key]]),
            ),
          }
        : {}),
      date: today,
    });
  }
  updateManifest("screenshots", entries);
  console.log(`Exported ${entries.length} screenshots to ${relative(repoRoot, outDir)}`);
}

if (!args.includes("--export-only")) {
  const given = flag("url");
  const client = given ? { url: given, stop: () => {} } : await startClient();
  try {
    capture(client.url);
  } finally {
    client.stop();
  }
}
exportScreenshots();
