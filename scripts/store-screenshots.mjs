#!/usr/bin/env node
// Real local-game captures. Every position starts at the empty board and
// every move is checked by the shared engine, then replayed through the UI.
// Start an isolated client first; pass its URL as the first argument.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import {
  confirmPendingJump,
  createInitialGameState,
  formatGameNotation,
  getJumpTargets,
  getSelectableJumpOrigins,
  isGameOver,
  jumpPiece,
  placePiece,
} from "../shared/src/tiao.ts";

const output = resolve("output/playwright/store-gameplay");
mkdirSync(output, { recursive: true });
const unwrap = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};
function random(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function chains(state) {
  const candidates = [];
  function visit(next, from, steps) {
    if (steps.length) candidates.push({ steps, pending: next });
    if (steps.length === 5) return;
    for (const to of getJumpTargets(next, from)) {
      visit(unwrap(jumpPiece(next, from, to)), to, [...steps, { from, to }]);
    }
  }
  for (const from of getSelectableJumpOrigins(state, state.currentTurn)) {
    visit(state, from, []);
  }
  return candidates.sort((a, b) => b.steps.length - a.steps.length);
}
function findScenes() {
  let combo = null;
  let victory = null;
  for (let seed = 1; seed <= 120 && (!combo || !victory); seed++) {
    const rng = random(seed);
    let state = createInitialGameState();
    const moves = [];
    for (let turn = 0; turn < 130 && !isGameOver(state); turn++) {
      const options = chains(state);
      const best = options[0];
      const occupied = state.positions.flat().filter(Boolean).length;
      if (best && occupied >= 28 && best.steps.length >= 4) {
        const scene = { seed, moves: [...moves], before: state, ...best };
        if (!combo && state.score[state.currentTurn] + best.steps.length < 10) combo = scene;
        if (
          !victory &&
          state.score[state.currentTurn] + best.steps.length >= 10 &&
          state.score[state.currentTurn] <
            state.score[state.currentTurn === "white" ? "black" : "white"]
        )
          victory = scene;
      }
      if (best && (rng() < 0.24 || turn > 90)) {
        const selected = rng() < 0.7 ? best : options[Math.floor(rng() * options.length)];
        moves.push({ type: "jump", color: state.currentTurn, steps: selected.steps });
        state = unwrap(confirmPendingJump(selected.pending));
      } else {
        let placed = false;
        for (let tries = 0; tries < 300; tries++) {
          const position = { x: 3 + Math.floor(rng() * 13), y: 3 + Math.floor(rng() * 13) };
          const result = placePiece(state, position);
          if (!result.ok) continue;
          moves.push({ type: "put", color: state.currentTurn, position });
          state = result.value;
          placed = true;
          break;
        }
        assert(placed);
      }
    }
  }
  assert(combo, "No four-capture scene found");
  assert(victory, "No winning comeback found");
  return { combo, victory };
}

const scenes = findScenes();
for (const [name, scene] of Object.entries(scenes)) {
  console.log(
    name,
    "seed",
    scene.seed,
    "turns",
    scene.moves.length,
    "captures",
    scene.steps.length,
    "score",
    scene.before.score,
  );
}
writeFileSync(resolve(output, "legal-replays.json"), JSON.stringify(scenes, null, 2));
if (process.argv.includes("--prepare-only")) process.exit(0);

const baseURL = process.argv[2];
assert(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(baseURL), "Pass isolated local client URL");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--mute-audio"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await page.addInitScript(() => {
    localStorage.setItem("tiao:analytics-consent", "denied");
    localStorage.setItem("tiao:knowsHowToPlay", "true");
    localStorage.setItem("tiao:boardTheme", "classic");
  });
  const cell = (p) => page.getByTestId(`cell-${p.x}-${p.y}`);
  async function checkBoard(state) {
    const rendered = await page
      .locator('[data-testid^="cell-"]')
      .evaluateAll((elements) =>
        elements.map((el) => ({ id: el.dataset.testid, piece: el.dataset.piece || null })),
      );
    assert.equal(rendered.length, state.boardSize * state.boardSize);
    for (const item of rendered) {
      const [, x, y] = item.id.split("-").map(Number);
      assert.equal(item.piece, state.positions[y][x], item.id);
    }
  }
  async function replay(scene) {
    await page.goto(`${baseURL}/local?autostart=1`, { waitUntil: "networkidle", timeout: 120000 });
    await cell({ x: 9, y: 9 }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Hide development chrome only. The game's DOM/styles are untouched.
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    let state = createInitialGameState();
    for (const [index, move] of scene.moves.entries()) {
      if (move.type === "put") {
        await cell(move.position).click();
        state = unwrap(placePiece(state, move.position));
      } else {
        await cell(move.steps[0].from).click();
        for (const step of move.steps) {
          await cell(step.to).click();
          state = unwrap(jumpPiece(state, step.from, step.to));
        }
        await cell(move.steps.at(-1).to).click();
        state = unwrap(confirmPendingJump(state));
      }
      await checkBoard(state);
      if ((index + 1) % 20 === 0) console.log("Replayed", index + 1, "legal turns");
    }
    assert.deepEqual(state.positions, scene.before.positions);
    return state;
  }
  async function shot(name, state) {
    await page.mouse.move(1900, 1060);
    await page.waitForTimeout(900);
    await checkBoard(state);
    const scores = await page.locator("p.tabular-nums").allTextContents();
    assert.deepEqual(
      scores.map((s) => s.replace(/\s/g, "")),
      [`${state.score.black}/${state.scoreToWin}`, `${state.score.white}/${state.scoreToWin}`],
    );
    await page.screenshot({ path: resolve(output, `${name}.png`), animations: "disabled" });
    console.log("Captured", name);
  }
  for (const [name, scene] of Object.entries(scenes)) {
    let state = await replay(scene);
    if (name === "combo") await shot("01-tactical-midgame", state);
    await cell(scene.steps[0].from).click();
    for (const step of scene.steps) {
      await cell(step.to).click();
      state = unwrap(jumpPiece(state, step.from, step.to));
      await checkBoard(state);
    }
    await shot(name === "combo" ? "02-four-stone-chain" : "04-winning-chain", state);
    await cell(scene.steps.at(-1).to).click();
    state = unwrap(confirmPendingJump(state));
    if (name === "combo") await shot("03-chain-confirmed", state);
    else {
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.waitForTimeout(4000); // Let the game's victory confetti finish.
      await shot("05-comeback-victory", state);
    }
    writeFileSync(resolve(output, `${name}-notation.txt`), formatGameNotation(state.history));
  }
} finally {
  await browser.close();
}
