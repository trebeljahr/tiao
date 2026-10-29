#!/usr/bin/env node
// Replay complete shipped-AI match logs through the real local-game UI.
// Capture only prefixes of those games; no scripted/random board construction.
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import {
  confirmPendingJump,
  createInitialGameState,
  formatGameNotation,
  jumpPiece,
  placePiece,
} from "../shared/src/tiao.ts";
import { chooseScenes, loadMatches, provenance, unwrap } from "./store-ai-scenes.mjs";
import { storeSize } from "./store-sizes.mjs";

const size = storeSize();
const root = resolve("output/playwright/store-gameplay");
const output = size.store ? resolve(root, size.name) : root;
mkdirSync(output, { recursive: true });
const matches = loadMatches();
const scenes = chooseScenes(matches);
writeFileSync(resolve(root, "ai-scenes.json"), `${JSON.stringify(scenes, null, 2)}\n`);
for (const [name, scene] of Object.entries(scenes))
  console.log(name, scene.matchId, "after decisions", scene.turn, "score", scene.before.score);
if (process.argv.includes("--prepare-only")) process.exit(0);
const baseURL = process.argv[2];
assert(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(baseURL), "Pass isolated local client URL");
// Earlier staged PNGs must not remain mixed into the current gameplay captures.
for (const file of readdirSync(output))
  if (/^\d{2}-.+\.(png|jpg)$/.test(file) || file === "combo-notation.txt")
    unlinkSync(resolve(output, file));
const proof = {};
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--mute-audio"],
});
try {
  const page = await browser.newPage({ viewport: size.viewport, deviceScaleFactor: size.scale });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("tiao:analytics-consent", "denied");
    localStorage.setItem("tiao:knowsHowToPlay", "true");
    localStorage.setItem("tiao:boardTheme", "classic");
    localStorage.setItem("tiao:soundEnabled", "0");
  });
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 200,
      json: { player: null, user: null, session: null, status: "none" },
    }),
  );
  await page.routeWebSocket(/\/(api\/)?ws/, (socket) => socket.onMessage(() => {}));
  const cell = (p) => page.getByTestId(`cell-${p.x}-${p.y}`);
  async function checkBoard(state) {
    const cells = await page
      .locator('[data-testid^="cell-"]')
      .evaluateAll((elements) =>
        elements.map((el) => ({ id: el.dataset.testid, piece: el.dataset.piece || null })),
      );
    assert.equal(cells.length, state.boardSize ** 2);
    for (const item of cells) {
      const [, x, y] = item.id.split("-").map(Number);
      assert.equal(item.piece, state.positions[y][x], item.id);
    }
  }
  async function replay(scene) {
    const match = matches[scene.matchId];
    await page.goto(
      `${baseURL}/local?autostart=1&boardSize=${match.record.boardSize}&scoreToWin=${match.record.scoreToWin}`,
      { waitUntil: "networkidle", timeout: 120000 },
    );
    await cell({
      x: Math.floor(match.record.boardSize / 2),
      y: Math.floor(match.record.boardSize / 2),
    }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "nextjs-portal { display:none !important; }" });
    let state = createInitialGameState(match.record);
    for (const [i, move] of scene.moves.entries()) {
      if (move.type === "place") {
        await cell(move.position).click();
        state = unwrap(placePiece(state, move.position));
      } else {
        await cell(move.from).click();
        let from = move.from;
        for (const to of move.path) {
          await cell(to).click();
          state = unwrap(jumpPiece(state, from, to));
          from = to;
        }
        await cell(move.path.at(-1)).click();
        state = unwrap(confirmPendingJump(state));
      }
      await checkBoard(state);
      assert.deepEqual(state, match.states[i + 1]);
      if ((i + 1) % 20 === 0) console.log("Replayed", match.id, i + 1, "AI decisions");
    }
    assert.deepEqual(state, scene.before);
    return state;
  }
  async function shot(name, state, scene, phase = "confirmed", turn = scene.turn) {
    await page.mouse.move(size.viewport.width - 4, size.viewport.height - 4);
    await page.waitForTimeout(900);
    await checkBoard(state);
    const scores = await page.locator("p.tabular-nums").allTextContents();
    assert.deepEqual(
      scores.map((s) => s.replace(/\s/g, "")),
      [`${state.score.black}/${state.scoreToWin}`, `${state.score.white}/${state.scoreToWin}`],
    );
    await page.screenshot({
      path: resolve(output, `${name}.${size.ext}`),
      animations: "disabled",
      ...(size.ext === "jpg" ? { type: "jpeg", quality: 92 } : {}),
    });
    proof[name] = provenance(matches[scene.matchId], state, turn, phase);
    console.log("Captured", name);
  }
  for (const [name, scene] of Object.entries(scenes)) {
    let state = await replay(scene);
    if (name === "developed") {
      await shot("00-ai-developed-position", state, scene);
      continue;
    }
    if (name === "capture") await shot("01-ai-tactical-position", state, scene);
    await cell(scene.move.from).click();
    let from = scene.move.from;
    for (const to of scene.move.path) {
      await cell(to).click();
      state = unwrap(jumpPiece(state, from, to));
      from = to;
      await checkBoard(state);
    }
    assert.deepEqual(state, scene.pending);
    await shot(
      name === "capture" ? "02-ai-capture-chain" : "04-ai-winning-chain",
      state,
      scene,
      "AI decision awaiting confirmation",
    );
    await cell(scene.move.path.at(-1)).click();
    state = unwrap(confirmPendingJump(state));
    assert.deepEqual(state, scene.after);
    if (name === "capture")
      await shot("03-ai-capture-confirmed", state, scene, "confirmed", scene.turn + 1);
    else {
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.waitForTimeout(4000);
      await shot("05-ai-victory", state, scene, "match finished", scene.turn + 1);
    }
    writeFileSync(resolve(output, `${name}-notation.txt`), formatGameNotation(state.history));
  }
  assert.deepEqual(errors, [], "Browser runtime errors");
  writeFileSync(resolve(output, "capture-provenance.json"), `${JSON.stringify(proof, null, 2)}\n`);
} finally {
  await browser.close();
}
