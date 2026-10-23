#!/usr/bin/env node
// Capture the shipped UI through an isolated Playwright CLI session.
// PLAYWRIGHT_CLI=/absolute/path/to/playwright-cli.js node scripts/store-trailer-capture.mjs <phase> <local-url> <output>
// Input fixtures are existing store-media samples, never production accounts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  confirmPendingJump,
  createInitialGameState,
  getWinner,
  jumpPiece,
  placePiece,
} from "../shared/src/tiao.ts";

const [phase, baseURL, dest = "build/store-trailer-v2"] = process.argv.slice(2);
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL));
const output = resolve(dest);
mkdirSync(resolve(output, "raw"), { recursive: true });
const cli = process.env.PLAYWRIGHT_CLI;
assert(cli, "Set PLAYWRIGHT_CLI to an installed Playwright CLI entry point");
const run = (...args) => {
  const result = spawnSync(process.execPath, [cli, "-s=tiao-trailer", ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  writeFileSync(resolve(output, `${phase}-${args[0]}.log`), result.stdout || "");
  console.log(`${args[0]}: ${(result.stdout || "").slice(-1200)}`);
  process.stderr.write(result.stderr || "");
  assert.equal(result.status, 0, `Playwright CLI ${args[0]} failed`);
  assert(!result.stdout?.includes("### Error"), result.stdout);
};
const scenes = JSON.parse(
  readFileSync("output/playwright/store-gameplay/legal-replays.json", "utf8"),
);
const unwrap = (result) => {
  assert(result.ok, JSON.stringify(result));
  return result.value;
};
// Independently validate every recorded placement, jump and final score.
for (const scene of Object.values(scenes)) {
  let state = createInitialGameState();
  for (const move of scene.moves) {
    if (move.type === "put") state = unwrap(placePiece(state, move.position));
    else {
      for (const step of move.steps) state = unwrap(jumpPiece(state, step.from, step.to));
      state = unwrap(confirmPendingJump(state));
    }
  }
  assert.deepEqual(state.positions, scene.before.positions);
  for (const step of scene.steps) state = unwrap(jumpPiece(state, step.from, step.to));
  const final = unwrap(confirmPendingJump(state));
  if (scene === scenes.victory) assert.equal(getWinner(final), "black");
}
const common = `
  const cell = p => page.getByTestId('cell-' + p.x + '-' + p.y);
  const pause = ms => page.waitForTimeout(ms);
  const click = async p => { await cell(p).hover(); await pause(180); await cell(p).click(); };
  const open = async path => { await page.goto(${JSON.stringify(baseURL)} + path, {waitUntil:'networkidle'}); await page.evaluate(() => document.fonts.ready); await pause(650); };
  const shot = async name => page.screenshot({path: ${JSON.stringify(resolve(output, "raw"))} + '/' + name + '.png'});
`;
let body = "";
let record = false;
if (phase === "setup") {
  const data = JSON.parse(readFileSync("output/playwright/store-ui/sample-api-data.json", "utf8"));
  const me = data["/api/player/me"].player;
  me.badges = ["tournament-champion", "one-jump-wonder", "flawless-victory"];
  me.activeBadges = [];
  data["/api/player/profile"] = {
    profile: {
      ...me,
      email: "aki@example.test",
      providers: ["credential"],
      gamesPlayed: 12,
      bio: "",
      createdAt: "2026-10-01T10:00:00Z",
    },
  };
  data["/api/player/account/exports"] = { exports: [] };
  data["/api/player/achievements"] = {
    achievements: [
      "first-move",
      "getting-started",
      "regular",
      "first-victory",
      "tournament-champion",
      "one-jump-wonder",
      "flawless-victory",
    ].map((achievementId) => ({ achievementId, unlockedAt: "2026-10-23T08:00:00Z" })),
  };
  data["/api/player/social/overview"].overview.incomingFriendRequests = [];
  data["/api/player/social/overview"].overview.outgoingFriendRequests = [];
  data["/api/games/W6N3RX"].snapshot.state = scenes.victory.before;
  data["/api/games/W6N3RX/access"].snapshot.state = scenes.victory.before;
  const tournament = data["/api/tournaments/AUTUMN8"].tournament;
  tournament.rounds.at(-1).matches[0].score = [6, 9];
  writeFileSync(resolve(output, "sample-api-data.json"), JSON.stringify(data, null, 2));
  body = `
    await page.setViewportSize({width:1920,height:1080});
    const data = ${JSON.stringify(data)};
    const me = data['/api/player/me'].player;
    await page.context().addInitScript(me => {
      localStorage.setItem('tiao:analytics-consent','denied');
      localStorage.setItem('tiao:knowsHowToPlay','true');
      localStorage.setItem('tiao:boardTheme','classic');
      localStorage.setItem('tiao:auth-cache',JSON.stringify({player:me}));
    }, me);
    await page.context().route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== ${JSON.stringify(baseURL)}) return route.abort();
      const p = url.pathname;
      if (p.startsWith('/sample-avatars/')) return route.fulfill({path:${JSON.stringify(resolve("output/playwright/store-ui/avatars"))} + '/' + p.split('/').at(-1)});
      if (p === '/api/player/badges/active') {
        const activeBadges = route.request().postDataJSON().activeBadges;
        me.activeBadges = activeBadges;
        return route.fulfill({json:{auth:{player:me},activeBadges}});
      }
      if (p.startsWith('/api/')) return route.fulfill({status:data[p]?200:404,json:data[p] || {message:'No local sample for ' + p}});
      return route.continue();
    });
    await page.context().routeWebSocket(/\\/api\\/ws/, socket => socket.onMessage(() => {}));
    await open('/local?autostart=1');
    await cell({x:9,y:9}).waitFor();
    await shot('setup');
    console.log(await page.locator('body').ariaSnapshot());
  `;
} else if (phase === "rules") {
  record = true;
  body = `
    await pause(400);
    await cell({x:9,y:9}).hover(); await pause(700);
    await click({x:9,y:9}); await pause(850);
    await click({x:10,y:9}); await pause(850);
    await shot('place');
    await click({x:9,y:9}); await pause(450);
    await cell({x:11,y:9}).hover(); await pause(1400);
    await shot('jump-preview');
    await cell({x:11,y:9}).click(); await pause(1100);
    await shot('jump-pending');
    await cell({x:11,y:9}).click(); await pause(1300);
    await shot('jump-confirmed');
  `;
} else if (phase.startsWith("prepare-")) {
  record = phase === "prepare-win";
  const scene = scenes[phase.slice(8) === "win" ? "victory" : "combo"];
  body = `
    await open('/local?autostart=1');
    await cell({x:9,y:9}).waitFor();
    const moves = ${JSON.stringify(scene.moves)};
    for (const move of moves) {
      if (move.type === 'put') await cell(move.position).click();
      else {
        await cell(move.steps[0].from).click();
        for (const step of move.steps) await cell(step.to).click();
        await cell(move.steps.at(-1).to).click();
      }
      await pause(100);
    }
    const expected = ${JSON.stringify(scene.before.positions)};
    const actual = await page.locator('[data-testid^="cell-"]').evaluateAll(els => els.map(el => ({id:el.dataset.testid,piece:el.dataset.piece || null})));
    for (const c of actual) { const [,x,y]=c.id.split('-').map(Number); if(c.piece!==expected[y][x]) throw Error('Board mismatch '+c.id); }
    await pause(700); await shot(${JSON.stringify(phase)});
  `;
} else if (phase === "chain" || phase === "win") {
  record = true;
  const scene = scenes[phase === "win" ? "victory" : "combo"];
  body = `
    const steps = ${JSON.stringify(scene.steps)};
    await pause(350); await click(steps[0].from); await pause(500);
    for (const [i,step] of steps.entries()) {
      await cell(step.to).hover(); await pause(i===0?1100:550);
      await cell(step.to).click(); await pause(650);
      await shot(${JSON.stringify(phase)} + '-step-' + i);
    }
    await pause(700); await cell(steps.at(-1).to).click(); await pause(2100);
    await shot(${JSON.stringify(phase)} + '-confirmed');
    console.log(await page.locator('body').ariaSnapshot());
  `;
} else if (phase === "friends") {
  awaitCodeOpen("/friends");
  record = true;
  body += `
    await pause(450);
    await page.getByRole('button',{name:'Invite to game',exact:true}).first().hover(); await pause(800);
    await page.getByRole('button',{name:'Invite to game',exact:true}).first().click(); await pause(1300);
    await page.getByRole('button',{name:'Black',exact:true}).click(); await pause(600);
    await page.getByRole('button',{name:'13x13',exact:true}).click(); await pause(700);
    await shot('friend-invite');
    console.log(await page.locator('body').ariaSnapshot());
  `;
} else if (phase === "tournament" || phase === "winner") {
  if (phase === "tournament") body += `await page.unroute('**/api/tournaments/AUTUMN8');`;
  if (phase === "winner") {
    const data = JSON.parse(readFileSync(resolve(output, "sample-api-data.json"), "utf8"));
    const t = data["/api/tournaments/AUTUMN8"].tournament;
    t.status = "finished";
    for (const p of t.participants)
      p.status = p.playerId === "sample-aki" ? "winner" : "eliminated";
    t.rounds.at(-1).status = "finished";
    Object.assign(t.rounds.at(-1).matches[0], {
      status: "finished",
      winner: "sample-aki",
      score: [10, 9],
      playerColors: ["black", "white"],
      finishReason: "captured",
      historyLength: 62,
    });
    body += `await page.route('**/api/tournaments/AUTUMN8',route=>route.fulfill({json:${JSON.stringify({ tournament: t })}}));`;
  }
  awaitCodeOpen("/tournament/AUTUMN8");
  record = true;
  body += `
    await page.getByText('Bracket',{exact:true}).evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
    await pause(800); await shot('${phase}-bracket');
    await page.getByRole('heading',{name:'Final',exact:true}).scrollIntoViewIfNeeded();
    await pause(1400);
    ${phase === "winner" ? `await page.getByText('Winner',{exact:true}).scrollIntoViewIfNeeded(); await pause(2000); await shot('winner-banner');` : `await page.getByRole('button',{name:'Play',exact:true}).last().hover(); await pause(800);`}
    console.log(await page.locator('body').ariaSnapshot());
  `;
} else if (phase === "badges") {
  body += `await page.evaluate(() => fetch('/api/player/badges/active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({activeBadges:[]})}));`;
  awaitCodeOpen("/settings");
  record = true;
  body += `
    await page.evaluate(() => { document.body.style.zoom = '1.6'; });
    await page.getByText('Champion',{exact:true}).last().scrollIntoViewIfNeeded();
    await pause(800);
    const badge = page.getByRole('button').filter({has:page.getByText('Champion',{exact:true})});
    await badge.hover(); await pause(650); await badge.click(); await pause(1800);
    await shot('badge-equipped');
    console.log(await page.locator('body').ariaSnapshot());
  `;
} else if (phase === "achievements") {
  awaitCodeOpen("/achievements");
  record = true;
  body += `
    await page.getByText('Tournament Champion',{exact:true}).scrollIntoViewIfNeeded(); await pause(1100);
    await shot('achievement-champion');
    await page.getByText('One Jump Wonder',{exact:true}).scrollIntoViewIfNeeded(); await pause(1200);
    await shot('achievement-combat');
    console.log(await page.locator('body').ariaSnapshot());
  `;
} else throw new Error(`Unknown phase ${phase}`);
function awaitCodeOpen(path) {
  body += `await open(${JSON.stringify(path)});`;
}
const file = resolve(output, `${phase}.capture.js`);
writeFileSync(file, `async (page) => {${common}${body}}`);
if (record)
  run("video-start", resolve(output, "raw", `${phase}.webm`), "--size=1920x1080", "--fps=30");
try {
  run("run-code", `--filename=${file}`);
} finally {
  if (record) run("video-stop");
}
