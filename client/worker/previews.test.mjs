// @vitest-environment node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import {
  pageUrl,
  parseDynamicPath,
  placeholderPath,
  previewDataPath,
  previewFor,
  runWorkerFirstPatterns,
} from "./previews.mjs";

test("parses the pages and payloads the Worker handles", () => {
  assert.deepEqual(parseDynamicPath("/game/ABC234"), {
    locale: "en",
    route: "game",
    id: "ABC234",
    payload: false,
  });
  assert.deepEqual(parseDynamicPath("/de/game/ABC234.txt"), {
    locale: "de",
    route: "game",
    id: "ABC234",
    payload: true,
  });
  assert.deepEqual(parseDynamicPath("/es/embed/game/ABC234"), {
    locale: "es",
    route: "embed/game",
    id: "ABC234",
    payload: false,
  });
  assert.equal(parseDynamicPath("/profile/J%C3%BCrgen").id, "Jürgen");
  for (const path of [
    "/game",
    "/game/",
    "/game/ABC234/",
    "/game/A/__next._tree.txt",
    "/play",
    "/en/game/X",
    "/fr/game/X",
    "/game/%E0%A4",
  ])
    assert.equal(parseDynamicPath(path), null, path);
});

test("maps every id onto its placeholder file", () => {
  assert.equal(placeholderPath(parseDynamicPath("/game/ABC234")), "/game/__spa__");
  assert.equal(placeholderPath(parseDynamicPath("/game/ABC234.txt")), "/game/__spa__.txt");
  assert.equal(
    placeholderPath(parseDynamicPath("/de/tournament/T1.txt")),
    "/de/tournament/__spa__.txt",
  );
  assert.equal(placeholderPath(parseDynamicPath("/embed/game/X")), "/embed/game/__spa__");
});

test("names the canonical URL and the data and image of each route", () => {
  assert.equal(pageUrl("en", "game", "ABC234"), "https://playtiao.com/game/ABC234");
  assert.equal(pageUrl("de", "profile", "a b"), "https://playtiao.com/de/profile/a%20b");
  assert.equal(previewDataPath("game", "ABC234"), "/api/games/ABC234/og");
  assert.equal(previewDataPath("profile", "rico"), "/api/player/profile/rico");
  assert.equal(previewDataPath("tournament", "T1"), "/api/tournaments/T1");
  assert.equal(previewDataPath("embed/game", "ABC234"), null);
});

test("writes a game's preview from its status", () => {
  const base = {
    boardSize: 13,
    scoreToWin: 5,
    score: { white: 5, black: 3 },
    white: "alice",
    black: "bob",
    timeControl: { initialMs: 300_000, incrementMs: 2_000 },
  };
  const target = { locale: "en", route: "game", id: "abc234" };
  assert.deepEqual(previewFor(target, { ...base, status: "finished" }), {
    title: "alice vs bob",
    description:
      "Watch or join this Tiao game. 13x13 board, first to 5 captures. Time control: 5+2.",
    socialDescription: "alice vs bob — final score 5-3",
    image: "https://playtiao.com/api/og/game/abc234.jpg",
  });
  const waiting = previewFor(target, {
    ...base,
    status: "waiting",
    black: null,
    whiteRating: 1612,
    timeControl: null,
  });
  assert.equal(waiting.title, "Tiao Game ABC234");
  assert.equal(waiting.socialDescription, "alice (1612) is waiting for an opponent");
  assert.equal(
    waiting.description,
    "Watch or join this Tiao game. 13x13 board, first to 5 captures wins.",
  );
  assert.equal(previewFor(target, null).title, "Tiao Game ABC234");
  assert.equal(previewFor({ ...target, locale: "de" }, null).title, "Tiao-Spiel ABC234");
});

test("writes profile and tournament previews, with or without data", () => {
  const profile = previewFor(
    { locale: "en", route: "profile", id: "rico" },
    { profile: { displayName: "Rico" } },
  );
  assert.equal(profile.title, "Rico on Tiao");
  assert.equal(profile.image, "https://playtiao.com/api/og/profile/rico.jpg");
  assert.equal(
    previewFor({ locale: "en", route: "profile", id: "ghost" }, null).title,
    "ghost on Tiao",
  );
  const tournament = previewFor(
    { locale: "en", route: "tournament", id: "T1" },
    {
      tournament: {
        name: "Autumn Cup",
        settings: { format: "round-robin" },
        participants: [{}, {}],
      },
    },
  );
  assert.equal(tournament.title, "Autumn Cup — Tiao Tournament");
  assert.equal(tournament.description, "2 players competing in a Round Robin tournament on Tiao.");
  assert.equal(
    previewFor({ locale: "en", route: "tournament", id: "T9" }, null).title,
    "Tiao Tournaments — Round Robin, Elimination, and More",
  );
});

test("wrangler.jsonc sends exactly the page and payload paths to the Worker", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "wrangler.jsonc"), "utf8");
  const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));
  assert.deepEqual(config.assets.run_worker_first, runWorkerFirstPatterns());
  assert.equal(config.main, "worker/index.mjs");
  assert.equal(config.assets.binding, "ASSETS");
  assert.equal(config.cache, undefined);
});
