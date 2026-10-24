#!/usr/bin/env node
// Lossless 2× UI screenshots: stepped AI clock, fresh normal-clock rule demo.
// Initialize the isolated CLI session with store-trailer-capture.mjs setup first.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [phase, baseURL, dest = "build/store-trailer-v10", firstArg = "0", countArg = "108"] =
  process.argv.slice(2);
const root = resolve(dest),
  first = Number(firstArg),
  count = Number(countArg);
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL));
const cli = process.env.PLAYWRIGHT_CLI;
assert(cli, "Set PLAYWRIGHT_CLI");
const match = JSON.parse(readFileSync("scripts/assets/store-trailer/ai-match.json", "utf8"));
const previous = JSON.parse(readFileSync("scripts/assets/store-trailer/move-events.json", "utf8"))
  .sources[0];
const ai = previous.events.map((e, i) => ({
  ...e,
  frame: 6 + i * 18,
  select: e.kind === "jump" && (i === 0 || previous.events[i - 1].turn !== e.turn),
}));
const counter = [
  {
    id: "rule-0",
    kind: "jump",
    color: "white",
    from: { x: 9, y: 9 },
    to: { x: 11, y: 11 },
    select: true,
  },
  {
    id: "rule-1",
    kind: "confirm",
    color: "white",
    captures: [{ x: 10, y: 10 }],
    position: { x: 11, y: 11 },
  },
  {
    id: "rule-2",
    kind: "jump",
    color: "black",
    from: { x: 10, y: 8 },
    to: { x: 12, y: 10 },
    select: true,
  },
  { id: "rule-3", kind: "jump", color: "black", from: { x: 12, y: 10 }, to: { x: 10, y: 12 } },
  {
    id: "rule-4",
    kind: "confirm",
    color: "black",
    captures: [
      { x: 11, y: 9 },
      { x: 11, y: 11 },
    ],
    position: { x: 10, y: 12 },
  },
].map((e, i) => ({ ...e, frame: 6 + i * 28 }));
// Confirmation clicks use the last path destination from the genuine ledger.
for (const e of ai) if (e.kind === "confirm") e.position = match.moves[e.turn].path.at(-1);
const common = `const cell=p=>page.getByTestId('cell-'+p.x+'-'+p.y);`;
let body;
if (phase.startsWith("prepare-")) {
  body = `${phase === "prepare-ai" ? "await page.clock.install();" : phase.endsWith("-real") ? "" : "await page.clock.resume();"}await page.goto(${JSON.stringify(baseURL)}+'/local?autostart=1',{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(500);`;
  if (phase.startsWith("prepare-counter"))
    body += `for(const p of [{x:9,y:9},{x:10,y:10},{x:11,y:9},{x:10,y:8}]){await cell(p).click({force:true});await page.waitForTimeout(90);}await page.waitForTimeout(350);`;
  body += `const a=await cell({x:0,y:0}).boundingBox(),b=await cell({x:1,y:0}).boundingBox();return {origin:[(a.x+a.width/2)*2,(a.y+a.height/2)*2],spacing:(b.x-a.x)*2,pixelRatio:2};`;
} else {
  assert(["ai", "ai-real", "counter", "counter-real"].includes(phase));
  const events = phase.startsWith("ai") ? ai : counter;
  const sourceName = phase.startsWith("counter")
    ? "counter"
    : phase.startsWith("ai")
      ? "ai"
      : phase;
  const folder = resolve(root, "raw", sourceName + "-hq");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    resolve(root, sourceName + "-hq-events.json"),
    JSON.stringify(events, null, 2) + "\n",
  );
  body = `
 const events=${JSON.stringify(events)};
 ${phase.endsWith("-real") ? "" : "await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));"}
 try {
 for(let f=${first};f<${first + count};f++){
  for(const e of events){
   if(f===e.frame-6&&e.select)await cell(e.from).click({force:true});
   if(f===e.frame-3&&e.kind!=='confirm')await cell(e.position||e.to).hover({force:true});
   if(f===e.frame)await cell(e.kind==='jump'?e.to:e.position).click({force:true});
  }
  ${phase.endsWith("-real") ? "await page.waitForTimeout(34);" : "await page.clock.runFor(f%3===2?34:33);"}
  if(${phase === "ai"}&&f>=1139&&f<=1142){const close=page.getByRole('button',{name:'Close',exact:true});if(await close.isVisible())await close.click({force:true});}
  await page.screenshot({path:${JSON.stringify(folder)}+'/f'+String(f).padStart(6,'0')+'.png'});
 }
 ${phase === "ai" && first + count >= 1224 ? `const actual=await page.locator('[data-testid^="cell-"]').evaluateAll(els=>els.map(el=>({id:el.dataset.testid,piece:el.dataset.piece||null})));const expected=${JSON.stringify(match.finalState.positions)};for(const c of actual){const[,x,y]=c.id.split('-').map(Number);if(c.piece!==expected[y][x])throw Error('AI replay mismatch '+c.id);}` : ""}
 return {first:${first},count:${count},scene:${JSON.stringify(phase)}};
 }finally{${phase.endsWith("-real") ? "" : "await page.clock.resume();"}}`;
}
const file = resolve(root, `${phase}-${first}.capture.js`);
writeFileSync(file, `async page=>{${common}${body}}`);
const result = spawnSync(
  process.execPath,
  [cli, "-s=tiao-trailer", "run-code", "--filename=" + file],
  { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
);
writeFileSync(resolve(root, `${phase}-${first}.log`), result.stdout || "");
process.stdout.write((result.stdout || "").slice(0, 900));
process.stderr.write(result.stderr || "");
assert.equal(result.status, 0);
assert(!result.stdout.includes("### Error"), result.stdout);
