process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  COMMAND_DEFINITIONS,
  type DiscordDataSource,
  dispatchInteraction,
  formatWinRate,
  handleLeaderboard,
  handlePuzzle,
  handleStats,
  InteractionResponseType,
  InteractionType,
  type LeaderboardEntry,
  type PlayerStats,
  type PuzzleOfTheWeek,
} from "../discord/commands";
import { discordConfigFromEnv } from "../discord/config";
import { tallyResults } from "../discord/dataSource";
import { loadPuzzleFromFile, parsePuzzle } from "../discord/puzzle";
import { createDiscordRest, type FetchLike } from "../discord/rest";

const PUZZLE: PuzzleOfTheWeek = {
  title: "Puzzle #7",
  weekOf: "2026-09-21",
  position: "White to jump and win in two.",
  sideToMove: "white",
  difficulty: "hard",
  imageUrl: "https://assets.example.com/puzzles/7.png",
};

function fakeSource(
  overrides: Partial<{
    players: LeaderboardEntry[];
    stats: Record<string, PlayerStats>;
    puzzle: PuzzleOfTheWeek | null;
  }> = {},
): DiscordDataSource {
  const players = overrides.players ?? [];
  const stats = overrides.stats ?? {};
  const puzzle = overrides.puzzle ?? null;
  return {
    async topPlayers(limit) {
      return players.slice(0, limit);
    },
    async findPlayerStats(username) {
      const key = Object.keys(stats).find((k) => k.toLowerCase() === username.toLowerCase());
      return key ? stats[key] : null;
    },
    async currentPuzzle() {
      return puzzle;
    },
  };
}

describe("Discord command definitions", () => {
  test("register exactly the three documented commands", () => {
    assert.deepEqual(
      COMMAND_DEFINITIONS.map((c) => c.name),
      ["leaderboard", "stats", "puzzle"],
    );
    const stats = COMMAND_DEFINITIONS.find((c) => c.name === "stats");
    assert.equal(stats?.options?.[0].name, "username");
    assert.equal(stats?.options?.[0].required, true);
    for (const command of COMMAND_DEFINITIONS) {
      assert.match(command.name, /^[a-z]+$/);
      assert.ok(command.description.length <= 100, `${command.name} description too long`);
    }
  });
});

describe("/leaderboard", () => {
  test("lists players ranked by ELO with medals", async () => {
    const players: LeaderboardEntry[] = [
      { displayName: "Alice", elo: 1820, gamesPlayed: 40 },
      { displayName: "Bob_the*Great", elo: 1700, gamesPlayed: 1 },
      { displayName: "Cara", elo: 1650, gamesPlayed: 12 },
      { displayName: "Dan", elo: 1600, gamesPlayed: 3 },
    ];
    const response = await handleLeaderboard(fakeSource({ players }));

    assert.equal(response.type, InteractionResponseType.ChannelMessageWithSource);
    const embed = response.data?.embeds?.[0];
    assert.ok(embed);
    assert.equal(embed.title, "Tiao leaderboard — top 4");
    const lines = embed.description?.split("\n") ?? [];
    assert.equal(lines.length, 4);
    assert.match(lines[0], /^🥇 Alice — \*\*1820\*\* \(40 games\)$/);
    assert.match(lines[1], /^🥈 Bob\\_the\\\*Great — \*\*1700\*\* \(1 game\)$/);
    assert.match(lines[3], /^\*\*4\.\*\* Dan/);
  });

  test("caps the list at ten players", async () => {
    const players = Array.from({ length: 15 }, (_, i) => ({
      displayName: `p${i}`,
      elo: 2000 - i,
      gamesPlayed: 5,
    }));
    const response = await handleLeaderboard(fakeSource({ players }));
    const lines = response.data?.embeds?.[0].description?.split("\n") ?? [];
    assert.equal(lines.length, 10);
    assert.equal(response.data?.embeds?.[0].title, "Tiao leaderboard — top 10");
  });

  test("explains when nobody has played a rated game", async () => {
    const response = await handleLeaderboard(fakeSource());
    assert.equal(response.type, InteractionResponseType.ChannelMessageWithSource);
    assert.match(response.data?.content ?? "", /No rated games/);
    assert.equal(response.data?.embeds, undefined);
  });
});

describe("/stats", () => {
  const stats: Record<string, PlayerStats> = {
    Alice: { displayName: "Alice", elo: 1723, gamesPlayed: 30, gamesWon: 20, gamesLost: 10 },
    Newbie: { displayName: "Newbie", elo: 1500, gamesPlayed: 0, gamesWon: 0, gamesLost: 0 },
  };

  test("shows ELO, games played and win rate for a known player", async () => {
    const response = await handleStats(fakeSource({ stats }), "alice");
    const embed = response.data?.embeds?.[0];
    assert.ok(embed);
    assert.equal(embed.title, "Alice");
    assert.deepEqual(
      embed.fields?.map((f) => [f.name, f.value]),
      [
        ["ELO", "1723"],
        ["Games played", "30"],
        ["Win rate", "67%"],
      ],
    );
    assert.equal(embed.footer?.text, "20 won · 10 lost");
    assert.equal(response.data?.flags, undefined, "found replies are public");
  });

  test("shows n/a win rate for a player without games", async () => {
    const response = await handleStats(fakeSource({ stats }), "Newbie");
    const winRate = response.data?.embeds?.[0].fields?.find((f) => f.name === "Win rate");
    assert.equal(winRate?.value, "n/a");
  });

  test("replies ephemerally with a clear message for an unknown username", async () => {
    const response = await handleStats(fakeSource({ stats }), "Nobody_Here");
    assert.equal(response.type, InteractionResponseType.ChannelMessageWithSource);
    assert.equal(response.data?.flags, 64);
    assert.match(response.data?.content ?? "", /No Tiao player named \*\*Nobody\\_Here\*\*/);
    assert.equal(response.data?.embeds, undefined);
  });

  test("asks for a username when the option is missing or blank", async () => {
    for (const value of [undefined, "", "   "]) {
      const response = await handleStats(fakeSource({ stats }), value);
      assert.equal(response.data?.flags, 64);
      assert.match(response.data?.content ?? "", /provide a username/);
    }
  });

  test("formatWinRate rounds to whole percent", () => {
    assert.equal(formatWinRate(0, 0), "n/a");
    assert.equal(formatWinRate(1, 2), "33%");
    assert.equal(formatWinRate(2, 1), "67%");
    assert.equal(formatWinRate(5, 0), "100%");
  });
});

describe("/puzzle", () => {
  test("renders the configured puzzle as an embed with the board image", async () => {
    const response = await handlePuzzle(fakeSource({ puzzle: PUZZLE }));
    const embed = response.data?.embeds?.[0];
    assert.ok(embed);
    assert.equal(embed.title, "Puzzle #7 · 2026-09-21");
    assert.equal(embed.description, PUZZLE.position);
    assert.equal(embed.image?.url, PUZZLE.imageUrl);
    assert.deepEqual(
      embed.fields?.map((f) => [f.name, f.value]),
      [
        ["Side to move", "White"],
        ["Difficulty", "hard"],
      ],
    );
  });

  test("falls back to a default title when none is configured", async () => {
    const { title: _title, weekOf: _weekOf, ...bare } = PUZZLE;
    const response = await handlePuzzle(fakeSource({ puzzle: { ...bare, sideToMove: "black" } }));
    const embed = response.data?.embeds?.[0];
    assert.equal(embed?.title, "Puzzle of the Week");
    assert.equal(embed?.fields?.[0].value, "Black");
  });

  test("says so clearly when no puzzle is configured", async () => {
    const response = await handlePuzzle(fakeSource({ puzzle: null }));
    assert.match(response.data?.content ?? "", /no Puzzle of the Week right now/);
    assert.equal(response.data?.embeds, undefined);
  });
});

describe("puzzle file source", () => {
  test("parses a complete record and rejects incomplete ones", () => {
    assert.deepEqual(parsePuzzle(PUZZLE), PUZZLE);
    assert.equal(parsePuzzle(null), null);
    assert.equal(parsePuzzle({ ...PUZZLE, sideToMove: "red" }), null);
    assert.equal(parsePuzzle({ ...PUZZLE, imageUrl: "" }), null);
    assert.equal(parsePuzzle({ ...PUZZLE, position: undefined }), null);
  });

  test("loads from disk and tolerates missing or broken files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tiao-puzzle-"));
    const good = join(dir, "puzzle.json");
    const broken = join(dir, "broken.json");
    await writeFile(good, JSON.stringify(PUZZLE));
    await writeFile(broken, "{ not json");

    assert.deepEqual(await loadPuzzleFromFile(good), PUZZLE);
    assert.equal(await loadPuzzleFromFile(broken), null);
    assert.equal(await loadPuzzleFromFile(join(dir, "missing.json")), null);
    assert.equal(await loadPuzzleFromFile(undefined), null);
  });
});

describe("dispatchInteraction", () => {
  test("answers a ping with a pong", async () => {
    const response = await dispatchInteraction({ type: InteractionType.Ping }, fakeSource());
    assert.deepEqual(response, { type: InteractionResponseType.Pong });
  });

  test("routes each command by name and reads the username option", async () => {
    const source = fakeSource({
      players: [{ displayName: "Alice", elo: 1600, gamesPlayed: 2 }],
      stats: {
        Alice: { displayName: "Alice", elo: 1600, gamesPlayed: 2, gamesWon: 1, gamesLost: 1 },
      },
      puzzle: PUZZLE,
    });
    const command = (
      name: string,
      options?: Array<{ name: string; type: number; value: string }>,
    ) =>
      dispatchInteraction(
        { type: InteractionType.ApplicationCommand, data: { name, options } },
        source,
      );

    assert.match((await command("leaderboard")).data?.embeds?.[0].title ?? "", /leaderboard/);
    assert.equal(
      (await command("stats", [{ name: "username", type: 3, value: "alice" }])).data?.embeds?.[0]
        .title,
      "Alice",
    );
    assert.equal((await command("puzzle")).data?.embeds?.[0].image?.url, PUZZLE.imageUrl);
  });

  test("rejects unknown commands and interaction types without throwing", async () => {
    const unknown = await dispatchInteraction(
      { type: InteractionType.ApplicationCommand, data: { name: "nope" } },
      fakeSource(),
    );
    assert.equal(unknown.data?.content, "Unknown command.");
    assert.equal(unknown.data?.flags, 64);

    const other = await dispatchInteraction({ type: 3 }, fakeSource());
    assert.equal(other.data?.content, "Unsupported interaction.");
  });
});

describe("tallyResults", () => {
  test("uses rating deltas when present and score otherwise", () => {
    const me = "p1";
    const games = [
      {
        seats: { white: { playerId: me }, black: { playerId: "x" } },
        ratingBefore: { white: 1500, black: 1500 },
        ratingAfter: { white: 1516, black: 1484 },
      },
      {
        seats: { white: { playerId: "x" }, black: { playerId: me } },
        ratingBefore: { white: 1500, black: 1500 },
        ratingAfter: { white: 1516, black: 1484 },
      },
      {
        seats: { white: { playerId: "x" }, black: { playerId: me } },
        state: { score: { white: 1, black: 3 }, scoreToWin: 3 },
      },
      { seats: { white: { playerId: "y" }, black: { playerId: "x" } } },
    ];
    assert.deepEqual(tallyResults(games, me), { gamesWon: 2, gamesLost: 1 });
  });
});

describe("discordConfigFromEnv", () => {
  test("is null unless both token and public key are set", () => {
    assert.equal(discordConfigFromEnv({}), null);
    assert.equal(discordConfigFromEnv({ DISCORD_BOT_TOKEN: "t" }), null);
    assert.equal(discordConfigFromEnv({ DISCORD_PUBLIC_KEY: "k" }), null);
    assert.equal(discordConfigFromEnv({ DISCORD_BOT_TOKEN: " ", DISCORD_PUBLIC_KEY: "k" }), null);
    assert.deepEqual(
      discordConfigFromEnv({
        DISCORD_BOT_TOKEN: "t",
        DISCORD_PUBLIC_KEY: "k",
        DISCORD_APPLICATION_ID: "123",
        DISCORD_PUZZLE_FILE: "",
      }),
      {
        botToken: "t",
        publicKey: "k",
        applicationId: "123",
        guildId: undefined,
        puzzleFile: undefined,
      },
    );
  });
});

describe("bulkOverwriteCommands", () => {
  function fakeFetch() {
    const calls: Array<{ url: string; method?: string; body?: string; auth?: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        url,
        method: init?.method,
        body: init?.body as string,
        auth: headers.Authorization,
      });
      return new Response(JSON.stringify([{ id: "1", name: "leaderboard" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    return { calls, fetchImpl };
  }

  test("PUTs the definitions to the global endpoint with the bot token", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const rest = createDiscordRest({ botToken: "tok", fetchImpl });
    const result = await rest.bulkOverwriteCommands("app1", COMMAND_DEFINITIONS);
    assert.deepEqual(result, [{ id: "1", name: "leaderboard" }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://discord.com/api/v10/applications/app1/commands");
    assert.equal(calls[0].method, "PUT");
    assert.equal(calls[0].auth, "Bot tok");
    assert.deepEqual(JSON.parse(calls[0].body ?? ""), COMMAND_DEFINITIONS);
  });

  test("scopes to a guild when a guild id is given", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const rest = createDiscordRest({ botToken: "tok", fetchImpl });
    await rest.bulkOverwriteCommands("app1", COMMAND_DEFINITIONS, "g9");
    assert.equal(calls[0].url, "https://discord.com/api/v10/applications/app1/guilds/g9/commands");
  });
});
