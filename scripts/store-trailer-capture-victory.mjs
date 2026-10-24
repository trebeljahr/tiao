#!/usr/bin/env node
// Capture the genuine match's final confirmation and native confetti in real time.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  confirmPendingJump,
  createInitialGameState,
  jumpPiece,
  placePiece,
} from "../shared/src/tiao.ts";

const [phase, baseURL, dest = "build/store-trailer-v10"] = process.argv.slice(2),
  root = resolve(dest),
  cli = process.env.PLAYWRIGHT_CLI;
assert(cli && /^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL));
const match = JSON.parse(readFileSync("scripts/assets/store-trailer/ai-match.json", "utf8"));
let state = createInitialGameState();
const unwrap = (r) => {
  assert(r.ok, JSON.stringify(r));
  return r.value;
};
for (const m of match.moves) {
  if (m.type === "place") state = unwrap(placePiece(state, m.position));
  else {
    let from = m.from;
    for (const to of m.path) {
      state = unwrap(jumpPiece(state, from, to));
      from = to;
    }
    if (m !== match.moves.at(-1)) state = unwrap(confirmPendingJump(state));
  }
}
writeFileSync(resolve(root, "victory-state.json"), JSON.stringify(state, null, 2) + "\n");
const common = `const cell=p=>page.getByTestId('cell-'+p.x+'-'+p.y);const pause=ms=>page.waitForTimeout(ms);`;
const validate = (expected) =>
  `const actual=await page.locator('[data-testid^="cell-"]').evaluateAll(els=>els.map(el=>({id:el.dataset.testid,piece:el.dataset.piece||null})));const expected=${JSON.stringify(expected)};for(const c of actual){const[,x,y]=c.id.split('-').map(Number);if(c.piece!==expected[y][x])throw Error('Victory board mismatch '+c.id);}`;
const body =
  phase === "prepare"
    ? `
 await page.goto(${JSON.stringify(baseURL)}+'/local?autostart=1',{waitUntil:'domcontentloaded'});await page.evaluate(()=>document.fonts.ready);await pause(600);
 const moves=${JSON.stringify(match.moves)};
 for(const [i,m]of moves.entries()){
  if(m.type==='place')await cell(m.position).click({force:true});
  else{await cell(m.from).click({force:true});for(const to of m.path){await cell(to).click({force:true});await pause(45);}if(i<moves.length-1)await cell(m.path.at(-1)).click({force:true});}
  await pause(65);
 }
 await pause(500);${validate(state.positions)}return {ready:true};
`
    : `
 await pause(500);await cell(${JSON.stringify(match.moves.at(-1).path.at(-1))}).click({force:true});
 await pause(650);const close=page.getByRole('button',{name:'Close',exact:true});if(await close.isVisible())await close.click({force:true});
 await pause(2200);${validate(match.finalState.positions)}await page.screenshot({path:${JSON.stringify(resolve(root, "raw/victory-real-time.png"))}});return {winner:${JSON.stringify(match.winner)},score:${JSON.stringify(match.finalState.score)},validated:true};
`;
const run = (...args) => {
  const r = spawnSync(process.execPath, [cli, "-s=tiao-trailer", ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  writeFileSync(resolve(root, `victory-${phase}-${args[0]}.log`), r.stdout || "");
  process.stdout.write((r.stdout || "").slice(0, 800));
  assert.equal(r.status, 0);
  assert(!r.stdout.includes("### Error"), r.stdout);
};
const file = resolve(root, `victory-${phase}.capture.js`);
writeFileSync(file, `async page=>{${common}${body}}`);
if (phase !== "prepare")
  run("video-start", resolve(root, "raw/victory-cadence.webm"), "--size=1920x1080", "--fps=30");
try {
  run("run-code", "--filename=" + file);
} finally {
  if (phase !== "prepare") run("video-stop");
}
