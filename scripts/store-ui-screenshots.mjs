#!/usr/bin/env node
// Capture the shipped UI with isolated sample API data, never production accounts.
// Usage: CHROMIUM_PATH=... node scripts/store-ui-screenshots.mjs http://localhost:59327
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import {
  confirmPendingJump,
  createInitialGameState,
  getJumpTargets,
  getSelectableJumpOrigins,
  getWinner,
  isGameOver,
  jumpPiece,
  placePiece,
} from "../shared/src/tiao.ts";

const baseURL = process.argv[2];
assert(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(baseURL));
const output = resolve("output/playwright/store-ui");
mkdirSync(output, { recursive: true });
const unwrap = (r) => {
  assert(r.ok, JSON.stringify(r));
  return r.value;
};
const scenes = JSON.parse(
  readFileSync("output/playwright/store-gameplay/legal-replays.json", "utf8"),
);
const victory = unwrap(confirmPendingJump(scenes.victory.pending));
function sampleGame(seed) {
  let state = createInitialGameState();
  let n = seed;
  const rng = () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
  for (let i = 0; i < 220 && !isGameOver(state); i++) {
    const origins = getSelectableJumpOrigins(state, state.currentTurn).filter(
      (p) => getJumpTargets(state, p).length,
    );
    if (origins.length && rng() < 0.6) {
      let from = origins[Math.floor(rng() * origins.length)];
      for (;;) {
        const targets = getJumpTargets(state, from);
        if (!targets.length) break;
        const to = targets[Math.floor(rng() * targets.length)];
        state = unwrap(jumpPiece(state, from, to));
        from = to;
      }
      state = unwrap(confirmPendingJump(state));
    } else {
      let placed = false;
      for (let j = 0; j < 400; j++) {
        const r = placePiece(state, {
          x: 3 + Math.floor(rng() * 13),
          y: 3 + Math.floor(rng() * 13),
        });
        if (r.ok) {
          state = r.value;
          placed = true;
          break;
        }
      }
      assert(placed);
    }
  }
  assert(isGameOver(state));
  return state;
}
const names = ["aki", "mira", "rowan", "sora", "jules", "niko", "rin", "kai"];
const people = names.map((displayName, i) => ({
  playerId: `sample-${displayName}`,
  displayName,
  profilePicture: `/sample-avatars/${displayName}.jpg`,
  kind: "account",
  rating: 1580 - i * 17,
  hasSeenTutorial: true,
  activeBadges: [],
  seed: i + 1,
}));
const me = people[0];
const slot = (p, online = true) => ({ player: p, online });
const now = new Date().toISOString();
const earlier = (h) => new Date(Date.now() - h * 3600000).toISOString();
function snapshot(gameId, state, opponent, h = 0) {
  return {
    gameId,
    state,
    roomType: "direct",
    status: isGameOver(state) ? "finished" : "active",
    createdAt: earlier(h + 1),
    updatedAt: earlier(h),
    players: [slot(me), slot(opponent)],
    spectators: [],
    seats: { black: slot(me), white: slot(opponent) },
    rematch: null,
    takeback: null,
    timeControl: null,
    clock: null,
    firstMoveDeadline: null,
  };
}
const games = [
  snapshot("Q7K2MP", victory, people[1], 1),
  snapshot("H3R8VN", sampleGame(21), people[2], 3),
  snapshot("D9S4LA", sampleGame(22), people[3], 23),
];
const active = {
  ...snapshot("W6N3RX", scenes.combo.before, people[1]),
  roomType: "tournament",
  tournamentId: "AUTUMN8",
};
function summary(s) {
  return {
    ...s,
    boardSize: s.state.boardSize,
    scoreToWin: s.state.scoreToWin,
    currentTurn: s.state.currentTurn,
    historyLength: s.state.history.length,
    winner: getWinner(s.state),
    finishReason: isGameOver(s.state) ? "captured" : null,
    yourSeat: "black",
    score: s.state.score,
    clockMs: null,
  };
}
const social = {
  friends: people.slice(1, 5).map((p, i) => ({ ...p, online: i < 2 })),
  incomingFriendRequests: [people[6]],
  outgoingFriendRequests: [people[7]],
  incomingInvitations: [],
  outgoingInvitations: [],
};
const settings = {
  format: "single-elimination",
  visibility: "public",
  timeControl: null,
  scheduling: "simultaneous",
  noShow: { type: "admin-decides" },
  minPlayers: 4,
  maxPlayers: 8,
  boardSize: 19,
  scoreToWin: 10,
};
const bracketGames = [];
function match(roundIndex, matchIndex, a, b, done) {
  const state = done ? sampleGame(30 + roundIndex * 4 + matchIndex) : null;
  const color = state ? getWinner(state) : "black";
  const other = color === "black" ? "white" : "black";
  const gameId = `T${roundIndex}${matchIndex}CUP`;
  if (state) {
    bracketGames.push({
      ...snapshot(gameId, state, b, 2 + roundIndex),
      roomType: "tournament",
      tournamentId: "AUTUMN8",
      players: [slot(a), slot(b)],
      seats: { [color]: slot(a), [other]: slot(b) },
    });
  }
  return {
    matchId: `r${roundIndex}m${matchIndex}`,
    roundIndex,
    matchIndex,
    players: [a, b],
    roomId: done ? gameId : null,
    winner: done ? a.playerId : null,
    score: state ? [state.score[color], state.score[other]] : [0, 0],
    status: done ? "finished" : "pending",
    finishReason: done ? "captured" : null,
    historyLength: state ? state.history.length : undefined,
    playerColors: [color, other],
  };
}
const rounds = [
  {
    roundIndex: 0,
    label: "Quarterfinals",
    status: "finished",
    matches: [
      match(0, 0, people[0], people[7], true, 9),
      match(0, 1, people[3], people[4], true, 7),
      match(0, 2, people[1], people[6], true, 6),
      match(0, 3, people[2], people[5], true, 8),
    ],
  },
  {
    roundIndex: 1,
    label: "Semifinals",
    status: "finished",
    matches: [
      match(1, 0, people[0], people[3], true, 8),
      match(1, 1, people[1], people[2], true, 9),
    ],
  },
  {
    roundIndex: 2,
    label: "Final",
    status: "active",
    matches: [
      {
        ...match(2, 0, people[0], people[1], false),
        status: "active",
        roomId: active.gameId,
        score: [3, 4],
      },
    ],
  },
];
const tournament = {
  tournamentId: "AUTUMN8",
  name: "Autumn Cup",
  description: "Eight players. Single elimination. First to ten captures.",
  creatorId: people[5].playerId,
  status: "active",
  settings,
  participants: people.map((p) => ({ ...p, status: p.seed <= 2 ? "active" : "eliminated" })),
  rounds,
  groups: [],
  knockoutRounds: [],
  featuredMatchId: "r2m0",
  isFeatured: false,
  playerIdentities: Object.fromEntries(people.map((p) => [p.playerId, p])),
  createdAt: earlier(24),
  updatedAt: now,
};
const tournaments = [
  {
    name: "Autumn Cup",
    tournamentId: "AUTUMN8",
    status: "active",
    playerCount: 8,
    maxPlayers: 8,
    format: "single-elimination",
  },
  {
    name: "Weekend Round Robin",
    tournamentId: "WEEKEND",
    status: "registration",
    playerCount: 6,
    maxPlayers: 8,
    format: "round-robin",
  },
  {
    name: "Evening Blitz",
    tournamentId: "BLITZ08",
    status: "registration",
    playerCount: 5,
    maxPlayers: 16,
    format: "single-elimination",
    timeControl: { initialMs: 180000, incrementMs: 2000 },
  },
  {
    name: "September Open",
    tournamentId: "SEPT026",
    status: "finished",
    playerCount: 16,
    maxPlayers: 16,
    format: "groups-knockout",
  },
].map((t) => ({
  creatorId: people[5].playerId,
  creatorDisplayName: people[5].displayName,
  visibility: "public",
  timeControl: settings.timeControl,
  boardSize: 19,
  scoreToWin: 10,
  isFeatured: false,
  createdAt: earlier(24),
  ...t,
}));
const responses = {
  "/api/auth/get-session": {
    user: {
      id: me.playerId,
      name: me.displayName,
      email: "aki@example.test",
      emailVerified: true,
      isAnonymous: false,
    },
    session: {
      id: "sample-session",
      userId: me.playerId,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
  },
  "/api/player/me": { player: me },
  "/api/health": { ok: true },
  "/api/player/social/overview": { overview: social },
  "/api/player/social/search": {
    results: [{ player: people[6], relationship: "incoming-request" }],
  },
  "/api/games": { games: { active: [summary(active)], finished: games.map(summary) } },
  "/api/tournaments": { tournaments },
  "/api/tournaments/my": { tournaments: [tournaments[0], tournaments[1]] },
  "/api/tournaments/my-pending-matches": { matches: [] },
  "/api/tournaments/AUTUMN8": { tournament },
};
for (const s of [active, ...games, ...bracketGames]) {
  responses[`/api/games/${s.gameId}`] = { snapshot: s };
  responses[`/api/games/${s.gameId}/access`] = { snapshot: s };
}
writeFileSync(resolve(output, "sample-api-data.json"), JSON.stringify(responses, null, 2));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--mute-audio"],
});
const errors = [];
const unexpected = new Set();
try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
  });
  await context.addInitScript(
    ({ me, req }) => {
      localStorage.setItem("tiao:analytics-consent", "denied");
      localStorage.setItem("tiao:knowsHowToPlay", "true");
      localStorage.setItem("tiao:auth-cache", JSON.stringify({ player: me }));
      sessionStorage.setItem(
        `tiao:toasted-notifs:${me.playerId}`,
        JSON.stringify([`friend-request:${req}`]),
      );
    },
    { me, req: people[6].playerId },
  );
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (responses[path]) return route.fulfill({ json: responses[path] });
    unexpected.add(path);
    return route.fulfill({ status: 404, json: { message: `No local sample for ${path}` } });
  });
  await context.route("**/sample-avatars/*.jpg", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1);
    assert(names.some((player) => name === `${player}.jpg`));
    await route.fulfill({
      contentType: "image/jpeg",
      body: readFileSync(resolve(output, "avatars", name)),
    });
  });
  await context.routeWebSocket(/\/api\/ws/, (socket) => {
    socket.onMessage(() => {});
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => errors.push(err.message));
  async function open(path, ready) {
    await page.goto(`${baseURL}${path}`, { waitUntil: "networkidle", timeout: 120000 });
    await page.getByText(ready, { exact: true }).first().waitFor({ timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "nextjs-portal { display:none !important; }" });
    await page.waitForTimeout(1200);
  }
  async function shoot(name, fullPage = false) {
    const avatarImages = page.locator('img[src^="/sample-avatars/"]');
    if (name !== "06-tournaments") {
      assert((await avatarImages.count()) > 0, `${name}: missing profile images`);
      await avatarImages.evaluateAll(async (images) => {
        await Promise.all(images.map((img) => img.decode()));
        if (images.some((img) => img.naturalWidth === 0)) throw new Error("Broken profile image");
      });
    }
    await page.mouse.move(1900, 1060);
    await page.screenshot({
      path: resolve(output, `${name}.png`),
      animations: "disabled",
      fullPage,
    });
    writeFileSync(resolve(output, `${name}.aria.txt`), await page.locator("body").ariaSnapshot());
    console.log("Captured", name);
  }
  await open("/tournaments", "Autumn Cup");
  await shoot("06-tournaments");
  await open("/tournament/AUTUMN8", "Bracket");
  await shoot("07-tournament-bracket-full", true);
  await page
    .getByText("Bracket", { exact: true })
    .evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
  await shoot("07-tournament-bracket");
  await open("/friends", "mira");
  await shoot("08-friends");
  await open("/games", "Match History");
  await shoot("09-game-history-full", true);
  await page
    .getByText("Match History", { exact: true })
    .evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
  await shoot("09-game-history");
  await open("/game/Q7K2MP", "mira");
  await page.getByTestId("review-nav-buttons").waitFor({ timeout: 30000 });
  await shoot("10-game-review");
  assert.deepEqual(errors, [], "Browser runtime errors");
  console.log("Unexpected API paths:", [...unexpected]);
} finally {
  await browser.close();
}
