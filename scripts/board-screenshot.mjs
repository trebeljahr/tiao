#!/usr/bin/env node
// Captures a mid-game board screenshot from the real app for README /
// store use.
//
// What it does:
//   1. Boots the server in e2e mode (NODE_ENV=test → in-memory game
//      service, no Redis, `/api/test-auth` enabled) and the Next dev
//      client, both on random high ports so a running `pnpm dev` on
//      3000/5005 is never touched.
//   2. Creates two accounts through the same `/api/test-auth` shortcut the
//      e2e suite uses, opens a game as one and joins as the other.
//   3. Generates a legal move sequence with the shared rules engine
//      (shared/src/tiao.ts) from a fixed seed and plays it through the
//      real WebSocket flow by clicking board cells in both browsers.
//   4. Screenshots the board page from the side of the player to move,
//      with the consent banner hidden and the requested board theme.
//   5. Quantises the PNG with ImageMagick when `magick` is on PATH.
//
// Usage:
//   node scripts/board-screenshot.mjs                      # docs/images/board.png
//   node scripts/board-screenshot.mjs --out foo.png --theme night
//   node scripts/board-screenshot.mjs --all-themes --out-dir /tmp/shots
//   node scripts/board-screenshot.mjs --width 1600 --height 1000 --seed 7 --turns 50
//   CHROMIUM_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell \
//     node scripts/board-screenshot.mjs   # reuse an already-downloaded Chromium
//
// Requires a local MongoDB on 27017 (or MONGODB_URI). Uses its own database
// (`tiao-screenshot`) and drops it on exit. Only kills the processes it
// spawned.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { MongoClient } from "mongodb";
import {
  confirmPendingJump,
  createInitialGameState,
  getJumpTargets,
  getSelectableJumpOrigins,
  isGameOver,
  jumpPiece,
  placePiece,
} from "../shared/src/tiao.ts";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

// ─── CLI ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
const ALL_THEMES = ["classic", "night", "sakura", "ocean", "marble"];
const allThemes = args.includes("--all-themes");
const theme = flag("theme", "classic");
const outPath = resolve(flag("out", "docs/images/board.png"));
const outDir = resolve(flag("out-dir", dirname(outPath)));
const width = Number(flag("width", "1600"));
const height = Number(flag("height", "1000"));
const seed = Number(flag("seed", "20260923"));
const minTurns = Number(flag("turns", "44"));
const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/tiao-screenshot";
const keepDb = args.includes("--keep-db");

// ─── Ports ────────────────────────────────────────────────────────────

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
    return true; // exit 0 → something listens
  } catch {
    return false;
  }
}

async function randomHighPort(taken) {
  for (let i = 0; i < 20; i++) {
    const port = 49152 + Math.floor(Math.random() * (65535 - 49152));
    if (taken.has(port)) continue;
    if (lsofBusy(port)) continue;
    if (!(await isPortFree(port))) continue;
    taken.add(port);
    return port;
  }
  throw new Error("could not find a free port in 49152-65535");
}

// ─── Process helpers ──────────────────────────────────────────────────

const children = [];
function run(cmd, cmdArgs, opts) {
  const child = spawn(cmd, cmdArgs, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  child.stdout.on("data", (d) => process.stderr.write(`[${opts.name}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${opts.name}] ${d}`));
  children.push(child);
  return child;
}

function stopChildren() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not come up within ${timeoutMs / 1000}s (${url})`);
}

// ─── Move generation (shared rules engine) ────────────────────────────

function mulberry32(seedValue) {
  let a = seedValue | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a mid-game position. Placements cluster around the centre so the
 * board reads like a real game; jumps are taken whenever available so
 * both sides have captures. Stops after the first jump once `minTurns`
 * turns are in, so the last-move trail on the screenshot shows a capture.
 */
function generateMoves(rng, minTurns) {
  let state = createInitialGameState();
  const moves = [];
  const size = state.boardSize;
  const mid = (size - 1) / 2;

  const gaussian = () => {
    const u = 1 - rng();
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const pick = (list) => list[Math.floor(rng() * list.length)];

  for (let turn = 0; turn < minTurns + 30 && !isGameOver(state); turn++) {
    const color = state.currentTurn;
    const origins = getSelectableJumpOrigins(state, color).filter(
      (from) => getJumpTargets(state, from, color).length > 0,
    );

    // Keep both scores well short of the win so the shot is mid-game.
    if (origins.length > 0 && state.score[color] < 6 && rng() < 0.5) {
      const from = pick(origins);
      const steps = [];
      let current = from;
      let next = state;
      for (;;) {
        const targets = getJumpTargets(next, current, color);
        if (targets.length === 0) break;
        const to = pick(targets);
        const result = jumpPiece(next, current, to);
        if (!result.ok) throw new Error(`generator: illegal jump ${result.code}`);
        next = result.value;
        steps.push({ from: current, to });
        current = to;
        if (rng() < 0.3) break; // sometimes stop a chain early
      }
      const confirmed = confirmPendingJump(next);
      if (!confirmed.ok) throw new Error(`generator: confirm failed ${confirmed.code}`);
      if (!isGameOver(confirmed.value)) {
        const captured = next.pendingCaptures.map((p) => ({ ...p }));
        state = confirmed.value;
        moves.push({ type: "jump", color, from, steps, captured });
        if (turn >= minTurns) break;
        continue;
      }
      // That chain would end the game — place a stone instead.
    }

    let placed = false;
    for (let attempt = 0; attempt < 200 && !placed; attempt++) {
      const x = Math.round(mid + gaussian() * 3.2);
      const y = Math.round(mid + gaussian() * 3.2);
      const result = placePiece(state, { x, y });
      if (!result.ok) continue;
      state = result.value;
      moves.push({ type: "put", color, position: { x, y } });
      placed = true;
    }
    if (!placed) throw new Error("generator: no placement found");
  }

  return { moves, state };
}

// ─── Browser helpers ──────────────────────────────────────────────────

const cellSel = (p) => `[data-testid="cell-${p.x}-${p.y}"]`;

async function waitForPiece(page, position, expected, timeoutMs = 15_000) {
  const locator = page.locator(cellSel(position));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const piece = await locator.getAttribute("data-piece");
    if ((piece ?? null) === expected) return;
    await page.waitForTimeout(60);
  }
  throw new Error(
    `cell ${position.x},${position.y} never became ${expected ?? "empty"} (page ${page.url()})`,
  );
}

/** Wait for the live board. During load a skeleton board renders the same
 * test ids, so match only the visible copy and let the others settle. */
async function waitForBoard(page, timeoutMs = 60_000) {
  await page
    .locator(`${cellSel({ x: 9, y: 9 })}:visible`)
    .first()
    .waitFor({ timeout: timeoutMs });
  await page.waitForTimeout(300);
}

async function whichPageIsLive(a, b, timeoutMs = 30_000) {
  const probe = `${cellSel({ x: 0, y: 0 })}:visible`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await a.locator(probe).isEnabled()) return true;
    if (await b.locator(probe).isEnabled()) return false;
    await a.waitForTimeout(100);
  }
  throw new Error("neither page has an enabled board");
}

async function signUp(context, baseUrl, username) {
  const res = await context.request.post(`${baseUrl}/api/test-auth`, {
    data: { username, password: "password123", email: `${username}@test.tiao.local` },
    timeout: 30_000,
  });
  if (!res.ok()) throw new Error(`test-auth failed (${res.status()}): ${await res.text()}`);
}

async function playMove(pages, move) {
  const page = pages[move.color];
  const other = pages[move.color === "white" ? "black" : "white"];

  if (move.type === "put") {
    await page.click(cellSel(move.position));
    await waitForPiece(page, move.position, move.color);
    await waitForPiece(other, move.position, move.color);
    return;
  }

  // Jump: select origin, click each destination, then click the final
  // destination again to confirm (mirrors MultiplayerGamePage.handleBoardClick).
  await page.click(cellSel(move.from));
  for (const step of move.steps) {
    await page.click(cellSel(step.to));
    await waitForPiece(page, step.to, move.color);
  }
  const last = move.steps[move.steps.length - 1].to;
  await page.click(cellSel(last));
  for (const p of [page, other]) {
    await waitForPiece(p, last, move.color);
    await waitForPiece(p, move.from, null);
    for (const c of move.captured) await waitForPiece(p, c, null);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  await dropDb(); // leftovers from an aborted run would collide on signup
  const taken = new Set();
  const apiPort = await randomHighPort(taken);
  const clientPort = await randomHighPort(taken);
  const baseUrl = `http://localhost:${clientPort}`;
  console.error(`ports: client ${clientPort}, server ${apiPort}`);

  run("node", ["--import", "tsx", "index.ts"], {
    name: "server",
    cwd: resolve(repoRoot, "server"),
    env: {
      ...process.env,
      NODE_ENV: "test",
      NODE_OPTIONS: "--no-warnings",
      PORT: String(apiPort),
      MONGODB_URI: mongoUri,
      TOKEN_SECRET: "screenshot-secret",
      S3_ENDPOINT: "http://localhost:9",
      S3_FORCE_PATH_STYLE: "true",
      S3_BUCKET_NAME: "tiao-screenshot",
      S3_PUBLIC_URL: "http://localhost:9/tiao-screenshot",
      AWS_ACCESS_KEY_ID: "unused",
      AWS_SECRET_ACCESS_KEY: "unused",
      AWS_REGION: "us-east-1",
      FRONTEND_URL: baseUrl,
    },
  });
  await waitForHttp(`http://localhost:${apiPort}/api/health`, 120_000, "server");

  run("node", ["server.mjs"], {
    name: "client",
    cwd: resolve(repoRoot, "client"),
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(clientPort),
      API_PORT: String(apiPort),
      NEXT_PUBLIC_API_PORT: String(apiPort),
    },
  });
  await waitForHttp(`${baseUrl}/manifest.json`, 180_000, "client");

  // CHROMIUM_PATH lets the script reuse a Chromium already in
  // ~/Library/Caches/ms-playwright when the exact build Playwright wants
  // is not installed (the versions are close enough for screenshots).
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const makeContext = async () => {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      baseURL: baseUrl,
    });
    await context.addInitScript((themeId) => {
      localStorage.setItem("tiao:analytics-consent", "denied");
      localStorage.setItem("tiao:knowsHowToPlay", "true");
      // Only seed the theme once so the per-theme override below survives reloads.
      if (!localStorage.getItem("tiao:boardTheme")) {
        localStorage.setItem("tiao:boardTheme", themeId);
      }
    }, theme);
    return context;
  };

  const rng = mulberry32(seed);
  const { moves, state } = generateMoves(rng, minTurns);
  console.error(
    `generated ${moves.length} moves, score white ${state.score.white} black ${state.score.black}`,
  );

  const hostContext = await makeContext();
  const guestContext = await makeContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  host.setDefaultNavigationTimeout(120_000);
  guest.setDefaultNavigationTimeout(120_000);

  await signUp(hostContext, baseUrl, "Aki");
  await signUp(guestContext, baseUrl, "Mira");

  await host.goto("/", { waitUntil: "domcontentloaded" });
  await host.locator('button:has-text("Create a game")').first().click({ timeout: 90_000 });
  await host.locator('button:has-text("Create Game")').click({ timeout: 30_000 });
  await host.waitForURL(/\/game\/[A-Z0-9]{6}/, { timeout: 60_000 });
  const gameUrl = host.url();
  const gameId = gameUrl.split("/").pop();

  await guest.goto(gameUrl, { waitUntil: "domcontentloaded" });
  for (const p of [host, guest]) {
    await p.locator("text=Live match").waitFor({ timeout: 90_000 });
    await waitForBoard(p);
  }

  // White moves first, so the page whose board is enabled right after the
  // join is the white seat.
  const hostIsWhite = await whichPageIsLive(host, guest);
  const pages = hostIsWhite ? { white: host, black: guest } : { white: guest, black: host };
  console.error(`game ${gameId}: host plays ${hostIsWhite ? "white" : "black"}`);

  for (const [i, move] of moves.entries()) {
    await playMove(pages, move);
    if ((i + 1) % 10 === 0) console.error(`played ${i + 1}/${moves.length}`);
  }

  // Shoot from the side of the player to move, so the board is live.
  const shooter = pages[state.currentTurn];
  mkdirSync(outDir, { recursive: true });
  const themes = allThemes ? ALL_THEMES : [theme];
  const shots = [];
  for (const id of themes) {
    await shooter.evaluate((t) => localStorage.setItem("tiao:boardTheme", t), id);
    await shooter.reload({ waitUntil: "domcontentloaded" });
    await waitForBoard(shooter);
    await shooter.mouse.move(0, 0);
    await shooter.waitForTimeout(2000); // fonts, trail animation
    // Drop transient chrome: the "Game resumed" toast and Next's dev badge.
    await shooter.evaluate(() => {
      for (const sel of ["[data-sonner-toaster]", "nextjs-portal"]) {
        for (const el of document.querySelectorAll(sel)) el.remove();
      }
    });
    await shooter.waitForTimeout(300);
    const file = allThemes ? resolve(outDir, `board-${id}.png`) : outPath;
    await shooter.screenshot({ path: file, type: "png" });
    shots.push(file);
  }

  await browser.close();

  for (const file of shots) optimise(file);
}

async function dropDb() {
  const client = new MongoClient(mongoUri);
  await client.connect();
  await client.db().dropDatabase();
  await client.close();
}

function optimise(file) {
  const before = statSync(file).size;
  try {
    execFileSync("magick", ["-version"], { stdio: "ignore" });
  } catch {
    console.error(`${file}: ${(before / 1024).toFixed(0)} KB (magick not found, left as is)`);
    return;
  }
  const tmp = `${file}.tmp.png`;
  execFileSync("magick", [
    file,
    "-strip",
    "-dither",
    "FloydSteinberg",
    "-colors",
    "255",
    `PNG8:${tmp}`,
  ]);
  const after = statSync(tmp).size;
  if (after < before) {
    execFileSync("mv", [tmp, file]);
    console.error(`${file}: ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB`);
  } else {
    execFileSync("rm", [tmp]);
    console.error(`${file}: ${(before / 1024).toFixed(0)} KB (quantised copy not smaller)`);
  }
}

process.on("SIGINT", () => {
  stopChildren();
  process.exit(130);
});

main()
  .then(() => 0)
  .catch((err) => {
    console.error(err);
    return 1;
  })
  .then(async (code) => {
    stopChildren();
    if (!keepDb) await dropDb().catch(() => undefined);
    process.exit(code);
  });
