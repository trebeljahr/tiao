import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createLeaderboardJobFromEnv,
  formatLeaderboard,
  LEADERBOARD_MESSAGE_ID_KEY,
  type LeaderboardJobDeps,
  type LeaderboardPlayer,
  runLeaderboardUpdate,
} from "../discord/leaderboardJob";
import { createDiscordRest, DiscordRestError, type FetchLike } from "../discord/rest";

// ---------------------------------------------------------------------------
// A fake fetch that records every call and answers from a script of
// responses. The REST client under test is the real one, so the assertions
// cover URL, method, auth header and body shape end to end.
// ---------------------------------------------------------------------------
type Recorded = { url: string; method: string; body: unknown; auth?: string };

function fakeFetch(script: Array<{ status: number; body?: unknown }>) {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      auth: headers.Authorization,
    });
    const next = script.shift();
    if (!next) throw new Error(`unexpected request: ${init?.method} ${url}`);
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: next.body === undefined ? {} : { "Content-Type": "application/json" },
    });
  };
  return { calls, fetchImpl };
}

function memorySettings(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getSetting: async (key: string) => store.get(key) ?? null,
    setSetting: async (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

const PLAYERS: LeaderboardPlayer[] = [
  { displayName: "alice", elo: 1720, gamesPlayed: 40 },
  { displayName: "bob_the*great", elo: 1650, gamesPlayed: 1 },
];

function makeDeps(
  fetchImpl: FetchLike,
  settings: ReturnType<typeof memorySettings>,
  players = PLAYERS,
): LeaderboardJobDeps {
  return {
    rest: createDiscordRest({ botToken: "tok", fetchImpl }),
    channelId: "chan1",
    fetchTopPlayers: async () => players,
    getSetting: settings.getSetting,
    setSetting: settings.setSetting,
    now: () => new Date("2026-09-23T06:00:00Z"),
  };
}

describe("formatLeaderboard", () => {
  test("ranks players, escapes markdown, pluralises games", () => {
    const text = formatLeaderboard(PLAYERS, new Date("2026-09-23T06:00:00Z"));
    assert.match(text, /🥇 \*\*alice\*\* — 1720 \(40 games\)/);
    assert.match(text, /🥈 \*\*bob\\_the\\\*great\*\* — 1650 \(1 game\)/);
    assert.match(text, /Updated 2026-09-23 06:00 UTC/);
  });

  test("uses a numeric rank past the medals", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      displayName: `p${i}`,
      elo: 1500 - i,
      gamesPlayed: 2,
    }));
    const text = formatLeaderboard(many, new Date());
    assert.match(text, /\n4\. \*\*p3\*\*/);
  });

  test("explains an empty board", () => {
    assert.match(formatLeaderboard([], new Date()), /No rated games yet/);
  });
});

describe("runLeaderboardUpdate", () => {
  test("first run creates, pins and stores the message id", async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 200, body: { id: "msg1", channel_id: "chan1", content: "" } },
      { status: 204 },
    ]);
    const settings = memorySettings();

    const result = await runLeaderboardUpdate(makeDeps(fetchImpl, settings));

    assert.deepEqual(result, { action: "created", messageId: "msg1" });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url, "https://discord.com/api/v10/channels/chan1/messages");
    assert.equal(calls[0].auth, "Bot tok");
    assert.match((calls[0].body as { content: string }).content, /alice/);
    assert.equal(calls[1].method, "PUT");
    assert.equal(calls[1].url, "https://discord.com/api/v10/channels/chan1/pins/msg1");
    assert.equal(settings.store.get(LEADERBOARD_MESSAGE_ID_KEY), "msg1");
  });

  test("second run edits the stored message instead of posting again", async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 200, body: { id: "msg1", channel_id: "chan1", content: "" } },
      { status: 204 },
      { status: 200, body: { id: "msg1", channel_id: "chan1", content: "" } },
    ]);
    const settings = memorySettings();
    const deps = makeDeps(fetchImpl, settings);

    await runLeaderboardUpdate(deps);
    const result = await runLeaderboardUpdate(deps);

    assert.deepEqual(result, { action: "edited", messageId: "msg1" });
    assert.equal(calls.length, 3);
    assert.equal(calls[2].method, "PATCH");
    assert.equal(calls[2].url, "https://discord.com/api/v10/channels/chan1/messages/msg1");
    assert.match((calls[2].body as { content: string }).content, /alice/);
  });

  test("a stored id from a previous boot is edited, not recreated", async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 200, body: { id: "old", channel_id: "chan1", content: "" } },
    ]);
    const settings = memorySettings({ [LEADERBOARD_MESSAGE_ID_KEY]: "old" });

    const result = await runLeaderboardUpdate(makeDeps(fetchImpl, settings));

    assert.deepEqual(result, { action: "edited", messageId: "old" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "PATCH");
  });

  test("recreates when the stored message was deleted (404 on edit)", async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 404, body: { message: "Unknown Message" } },
      { status: 200, body: { id: "msg2", channel_id: "chan1", content: "" } },
      { status: 204 },
    ]);
    const settings = memorySettings({ [LEADERBOARD_MESSAGE_ID_KEY]: "gone" });

    const result = await runLeaderboardUpdate(makeDeps(fetchImpl, settings));

    assert.deepEqual(result, { action: "recreated", messageId: "msg2" });
    assert.deepEqual(
      calls.map((c) => c.method),
      ["PATCH", "POST", "PUT"],
    );
    assert.equal(settings.store.get(LEADERBOARD_MESSAGE_ID_KEY), "msg2");
  });

  test("propagates non-404 edit failures without posting a duplicate", async () => {
    const { calls, fetchImpl } = fakeFetch([{ status: 429, body: { retry_after: 3 } }]);
    const settings = memorySettings({ [LEADERBOARD_MESSAGE_ID_KEY]: "msg1" });

    await assert.rejects(
      runLeaderboardUpdate(makeDeps(fetchImpl, settings)),
      (err: unknown) => err instanceof DiscordRestError && err.status === 429,
    );
    assert.equal(calls.length, 1);
    assert.equal(settings.store.get(LEADERBOARD_MESSAGE_ID_KEY), "msg1");
  });

  test("keeps the message id even when pinning fails", async () => {
    const { fetchImpl } = fakeFetch([
      { status: 200, body: { id: "msg1", channel_id: "chan1", content: "" } },
      { status: 403, body: { message: "Missing Permissions" } },
    ]);
    const settings = memorySettings();

    const result = await runLeaderboardUpdate(makeDeps(fetchImpl, settings));

    assert.equal(result.action, "created");
    assert.equal(settings.store.get(LEADERBOARD_MESSAGE_ID_KEY), "msg1");
  });
});

describe("createLeaderboardJobFromEnv", () => {
  test("returns null when either env var is missing", () => {
    assert.equal(createLeaderboardJobFromEnv({}), null);
    assert.equal(createLeaderboardJobFromEnv({ DISCORD_BOT_TOKEN: "tok" }), null);
    assert.equal(createLeaderboardJobFromEnv({ DISCORD_CHANNEL_GAME_RESULTS: "chan" }), null);
    assert.equal(
      createLeaderboardJobFromEnv({
        DISCORD_BOT_TOKEN: "  ",
        DISCORD_CHANNEL_GAME_RESULTS: "chan",
      }),
      null,
    );
  });

  test("returns a job when both are set", () => {
    const job = createLeaderboardJobFromEnv({
      DISCORD_BOT_TOKEN: "tok",
      DISCORD_CHANNEL_GAME_RESULTS: "chan",
    });
    assert.equal(typeof job, "function");
  });
});
