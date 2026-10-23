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
  getJumpTargets,
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
  me.unlockedThemes = ["night", "sakura", "ocean", "marble"];
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
      "first-blood",
      "chain-reaction",
      "speed-demon",
      "first-friend",
      "ai-easy",
      "ai-medium",
      "tutorial-complete",
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
} else if (phase === "prepare-opening" || phase === "prepare-finale") {
  const moves = phase === "prepare-finale" ? scenes.victory.moves.slice(0, 56) : [];
  body = `
    await open('/local?autostart=1');
    await cell({x:9,y:9}).waitFor();
    for (const move of ${JSON.stringify(moves)}) {
      if (move.type === 'put') await cell(move.position).click();
      else {
        await cell(move.steps[0].from).click();
        for (const step of move.steps) await cell(step.to).click();
        await cell(move.steps.at(-1).to).click();
      }
      await pause(100);
    }
    await pause(350);
  `;
} else if (phase === "ai-match") {
  const match = JSON.parse(readFileSync("scripts/assets/store-trailer/ai-match.json", "utf8"));
  record = true;
  body = `
    const moves = ${JSON.stringify(match.moves)};
    const events=[];
    const now=()=>Date.now();
    await pause(300);
    for (const move of moves) {
      if(move.type==='place') {
        await cell(move.position).hover();await pause(90);
        const start=now();await cell(move.position).click();
        events.push({kind:'place',turn:move.turn,color:move.color,position:move.position,start,end:now()});
        await pause(230);
      } else {
        await cell(move.from).click();await pause(90);
        let from=move.from;
        for(const to of move.path) {
          await cell(to).hover();await pause(90);
          const start=now();await cell(to).click();
          events.push({kind:'jump',turn:move.turn,color:move.color,from,to,start,end:now()});from=to;
          await pause(230);
        }
        const start=now();await cell(move.path.at(-1)).click();
        events.push({kind:'confirm',turn:move.turn,color:move.color,start,end:now()});
        await pause(230);
      }
    }
    await pause(1000);
    const viewBoard=page.getByRole('button',{name:'Close',exact:true});
    if(await viewBoard.isVisible()) await viewBoard.click();
    await pause(600);
    const actual=await page.locator('[data-testid^="cell-"]').evaluateAll(els=>els.map(el=>({id:el.dataset.testid,piece:el.dataset.piece||null})));
    const expected=${JSON.stringify(match.finalState.positions)};
    for(const c of actual){const[,x,y]=c.id.split('-').map(Number);if(c.piece!==expected[y][x])throw Error('AI replay mismatch '+c.id);}
    await shot('ai-match-winner');
    console.log(JSON.stringify({replayEvents:events}));
  `;
} else if (phase === "ai-result") {
  body = `await page.getByRole('button',{name:'Close',exact:true}).click();await pause(300);`;
} else if (phase === "ai-result-hold") {
  record = true;
  body = `await pause(1500);await shot('ai-result');`;
} else if (phase === "prepare-ai-theme") {
  const match = JSON.parse(readFileSync("scripts/assets/store-trailer/ai-match.json", "utf8"));
  body = `
    await open('/local?autostart=1');
    for(const move of ${JSON.stringify(match.moves.slice(0, -1))}) {
      if(move.type==='place') await cell(move.position).click();
      else {await cell(move.from).click();for(const to of move.path) await cell(to).click();await cell(move.path.at(-1)).click();}
      await pause(80);
    }
    await pause(350);
  `;
} else if (phase === "prepare-counter") {
  const positions = [
    { x: 9, y: 9 },
    { x: 10, y: 10 },
    { x: 11, y: 9 },
    { x: 10, y: 8 },
  ];
  body = `
    await open('/local?autostart=1');
    for(const position of ${JSON.stringify(positions)}){await cell(position).click();await pause(100);}
    await pause(350);
  `;
} else if (phase === "counter") {
  record = true;
  body = `
    await pause(300);
    await cell({x:9,y:9}).click();await pause(200);
    await cell({x:11,y:11}).hover();await pause(600);
    await cell({x:11,y:11}).click();await pause(550);
    await cell({x:11,y:11}).click();await pause(400);
    await cell({x:10,y:8}).click();await pause(200);
    await cell({x:12,y:10}).hover();await pause(350);
    await cell({x:12,y:10}).click();await pause(500);
    await cell({x:10,y:12}).hover();await pause(300);
    await cell({x:10,y:12}).click();await pause(450);
    await cell({x:10,y:12}).click();await pause(800);
    await shot('counter-confirmed');
  `;
} else if (phase === "prepare-customization") {
  awaitCodeOpen("/settings");
  body += `await page.getByText('Badge',{exact:true}).scrollIntoViewIfNeeded();await pause(500);await shot('badge-layout-current');`;
} else if (phase === "customization") {
  record = true;
  body = `
    const badge=name=>page.getByRole('button').filter({has:page.getByText(name,{exact:true})});
    await pause(300);
    await badge('Champion').click();await pause(800);
    await badge('One Jump Wonder').click();await pause(800);
    await badge('Flawless').click();await pause(900);
    await shot('badge-layout-selected');
  `;
} else if (phase === "opening-safe") {
  const { positions } = JSON.parse(
    readFileSync("scripts/assets/store-trailer/opening-safe.json", "utf8"),
  );
  let state = createInitialGameState();
  for (const position of positions) {
    state = unwrap(placePiece(state, position));
    for (let y = 0; y < state.boardSize; y++)
      for (let x = 0; x < state.boardSize; x++)
        if (state.positions[y][x]) assert.equal(getJumpTargets(state, { x, y }).length, 0);
  }
  record = true;
  body = `
    await pause(250);
    for (const position of ${JSON.stringify(positions)}) {
      await cell(position).hover(); await pause(100);
      await cell(position).click(); await pause(450);
    }
    await page.mouse.move(1350,700); await pause(650);
    await shot('opening-safe-settled');
  `;
} else if (phase === "prepare-badges") {
  awaitCodeOpen("/settings");
  body += `
    await page.evaluate(() => {document.body.style.zoom='2';document.body.style.paddingBottom='500px';});
    await page.getByText('Badge',{exact:true}).evaluate(el=>el.parentElement.scrollIntoView({block:'center'}));
    await pause(500);
    console.log(await page.locator('body').ariaSnapshot());
    await shot('badge-framing');
  `;
} else if (phase === "badges-framed") {
  record = true;
  body = `
    const badge = name => page.getByRole('button').filter({has:page.getByText(name,{exact:true})});
    await pause(250);
    await badge('Champion').hover(); await pause(200); await badge('Champion').click(); await pause(650);
    await badge('One Jump Wonder').hover(); await pause(200); await badge('One Jump Wonder').click(); await pause(650);
    await badge('Flawless').hover(); await pause(200); await badge('Flawless').click(); await pause(800);
    await shot('badges-framed-settled');
  `;
} else if (phase === "opening-clean") {
  const positions = [
    { x: 9, y: 9 },
    { x: 10, y: 10 },
    { x: 11, y: 9 },
    { x: 10, y: 8 },
  ];
  let state = createInitialGameState();
  for (const position of positions) state = unwrap(placePiece(state, position));
  state = unwrap(jumpPiece(state, { x: 9, y: 9 }, { x: 11, y: 11 }));
  unwrap(confirmPendingJump(state));
  record = true;
  body = `
    await pause(250);
    for (const position of ${JSON.stringify(positions)}) {
      await cell(position).hover(); await pause(100);
      await cell(position).click(); await pause(450);
    }
    await cell({x:9,y:9}).click(); await pause(250);
    await cell({x:11,y:11}).hover(); await pause(650);
    await cell({x:11,y:11}).click(); await pause(700);
    await cell({x:11,y:11}).click(); await pause(1100);
    await shot('opening-clean-confirmed');
  `;
} else if (phase === "finale-continuous") {
  let final = scenes.victory.before;
  for (const step of scenes.victory.steps) final = unwrap(jumpPiece(final, step.from, step.to));
  final = unwrap(confirmPendingJump(final));
  assert.equal(getWinner(final), "black");
  record = true;
  body = `
    await pause(300);
    for (const [i, move] of ${JSON.stringify(scenes.victory.moves.slice(56))}.entries()) {
      if (move.type === 'put') {
        await cell(move.position).hover(); await pause(140);
        await cell(move.position).click(); await pause(500 - i * 35);
      } else {
        await cell(move.steps[0].from).click(); await pause(200);
        for (const [j, step] of move.steps.entries()) {
          await cell(step.to).hover(); await pause(220 - j * 30);
          await cell(step.to).click(); await pause(320 - j * 35);
        }
        await cell(move.steps.at(-1).to).click(); await pause(450);
      }
    }
    const steps = ${JSON.stringify(scenes.victory.steps)};
    await cell(steps[0].from).click(); await pause(250);
    for (const [j, step] of steps.entries()) {
      await cell(step.to).hover(); await pause(200 - j * 25);
      await cell(step.to).click(); await pause(320 - j * 35);
    }
    await cell(steps.at(-1).to).click(); await pause(1500);
    const actual = await page.locator('[data-testid^="cell-"]').evaluateAll(els => els.map(el => ({id:el.dataset.testid,piece:el.dataset.piece || null})));
    const expected = ${JSON.stringify(final.positions)};
    for (const c of actual) { const [,x,y]=c.id.split('-').map(Number); if(c.piece!==expected[y][x]) throw Error('Board mismatch '+c.id); }
    console.log('Continuous legal final exchange, followed by Black winning 10–9.');
    await shot('finale-continuous-winner');
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
    body += `await page.context().route('**/api/tournaments/AUTUMN8{,/access}',route=>route.fulfill({json:${JSON.stringify({ tournament: t })}}));`;
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
} else if (phase === "badges-rich") {
  awaitCodeOpen("/settings");
  body += `await page.evaluate(() => {document.body.style.zoom='2.6';}); await page.getByText('Champion',{exact:true}).last().scrollIntoViewIfNeeded(); await pause(600);`;
  record = true;
  body += `
    const badge = name => page.getByRole('button').filter({has:page.getByText(name,{exact:true})});
    await badge('Champion').click(); await pause(900); await shot('badge-rich-champion');
    await badge('One Jump Wonder').click(); await pause(900); await shot('badge-rich-chain');
    await badge('Flawless').click(); await pause(900); await shot('badge-rich-flawless');
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
} else if (phase === "themes") {
  record = true;
  body += `
    if(await page.getByRole('button',{name:'Open navigation',exact:true}).getAttribute('aria-expanded')!=='true') await page.getByRole('button',{name:'Open navigation',exact:true}).click();
    await pause(650);
    for (const theme of ['Night','Sakura','Ocean','Marble','Classic']) {
      await page.getByRole('button',{name:theme+' board theme',exact:true}).click();
      await pause(400);
      await page.getByRole('button',{name:'Open navigation',exact:true}).click(); await pause(850);
      await shot('ai-theme-'+theme.toLowerCase());
      if(theme!=='Classic') { await page.getByRole('button',{name:'Open navigation',exact:true}).click(); await pause(300); }
    }
  `;
} else if (phase === "achievements-rich") {
  awaitCodeOpen("/achievements");
  record = true;
  body += `
    await page.evaluate(() => { document.body.style.zoom='1.5'; });
    await page.getByText('First Blood',{exact:true}).scrollIntoViewIfNeeded(); await pause(1000);
    await shot('achievement-grid');
    await page.mouse.wheel(0,500); await pause(1200);
    await shot('achievement-grid-lower');
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
