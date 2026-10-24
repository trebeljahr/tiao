#!/usr/bin/env node
// Record the actual friends list, received invitation and acceptance with isolated fixtures.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInitialGameState } from "../shared/src/tiao.ts";

const [baseURL, dest = "build/store-trailer-v10"] = process.argv.slice(2);
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL));
const root = resolve(dest),
  cli = process.env.PLAYWRIGHT_CLI;
assert(cli);
const data = JSON.parse(readFileSync(resolve(root, "sample-api-data.json"), "utf8"));
const overview = data["/api/player/social/overview"].overview;
const names = [
  "elin",
  "noah",
  "yuna",
  "leo",
  "ines",
  "theo",
  "mae",
  "sam",
  "emi",
  "luca",
  "ren",
  "lina",
];
for (const [i, name] of names.entries())
  overview.friends.push({
    playerId: "sample-" + name,
    displayName: name,
    online: i % 3 !== 0,
    rating: 1450 + i * 17,
    activeBadges: [],
  });
const me = data["/api/player/me"].player,
  sender = overview.friends[0];
const invitation = {
  id: "sample-trailer-invite",
  gameId: "FRIEND1",
  roomType: "custom",
  sender,
  recipient: me,
  createdAt: "2026-10-23T12:00:00Z",
  expiresAt: "2027-01-01T00:00:00Z",
  boardSize: 19,
  scoreToWin: 10,
  assignedColor: "black",
  timeControl: null,
};
const snapshot = structuredClone(data["/api/games/W6N3RX"].snapshot);
Object.assign(snapshot, {
  gameId: "FRIEND1",
  roomType: "custom",
  tournamentId: null,
  state: createInitialGameState(),
  status: "active",
});
for (const path of ["/api/games/FRIEND1", "/api/games/FRIEND1/access", "/api/games/FRIEND1/join"])
  data[path] = { snapshot };
writeFileSync(
  resolve(root, "friends-fixture.json"),
  JSON.stringify({ data, invitation }, null, 2) + "\n",
);
for (const name of ["friends-hq", "invite-hq"])
  mkdirSync(resolve(root, "raw", name), { recursive: true });
const body = `async page=>{
 await page.clock.resume();
 const data=${JSON.stringify(data)},invitation=${JSON.stringify(invitation)},sockets=[];
 const overview=data['/api/player/social/overview'].overview;
 await page.context().route('**/api/**',route=>{const p=new URL(route.request().url()).pathname;return route.fulfill({status:data[p]?200:404,json:data[p]||{message:'No isolated sample for '+p}});});
 await page.context().routeWebSocket(/\\/api\\/ws\\/lobby/,socket=>{sockets.push(socket);socket.onMessage(()=>{});});
 const open=async path=>{await page.clock.resume();await page.goto(${JSON.stringify(baseURL)}+path,{waitUntil:'domcontentloaded'});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(600);await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));};
 const frame=async(name,f)=>{await page.clock.runFor(f%3===2?34:33);await page.screenshot({path:${JSON.stringify(resolve(root, "raw"))}+'/'+name+'/f'+String(f).padStart(6,'0')+'.png'});};
 try{
 if(${!process.argv.includes("--invite-only")}){
 await open('/friends');
 const heading=page.getByText('Friends',{exact:true}).last();
 const y=await heading.evaluate(el=>el.getBoundingClientRect().top+scrollY-80);
 for(let f=0;f<72;f++){
  const progress=Math.max(0,Math.min(1,(f-10)/50));
  const target=y+850*(progress*progress*(3-2*progress));
  await page.evaluate(top=>window.scrollTo({top,behavior:'instant'}),target);
  await frame('friends-hq',f);
 }
 }
 await open('/play');
 const section=page.locator('#invitations');await section.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));await page.clock.runFor(300);
 let invitationBounds;
 for(let f=0;f<87;f++){
  if(f===8){overview.incomingInvitations=[invitation];for(const socket of sockets){try{socket.send(JSON.stringify({type:'social-update',overview}));}catch{}}}
  if(f===30)invitationBounds=await section.boundingBox();
  if(f===48)await section.getByRole('button',{name:'Accept',exact:true}).click({force:true});
  await frame('invite-hq',f);
 }
 if(!page.url().includes('/game/FRIEND1'))throw Error('Invitation was not accepted into its real game route');
 await page.getByTestId('cell-9-9').waitFor({state:'attached'});
 return {invitationBounds,friendCount:overview.friends.length,acceptedGameURL:page.url(),invitationFrames:87,listFrames:72};
 }finally{await page.clock.resume();}
}`;
const file = resolve(root, "friends-flow.capture.js");
writeFileSync(file, body);
const result = spawnSync(
  process.execPath,
  [cli, "-s=tiao-trailer", "run-code", "--filename=" + file],
  { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
);
writeFileSync(resolve(root, "friends-flow.log"), result.stdout || "");
process.stdout.write((result.stdout || "").slice(0, 1000));
assert.equal(result.status, 0);
assert(!result.stdout.includes("### Error"), result.stdout);
