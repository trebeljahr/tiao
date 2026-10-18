import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import express from "express";
import type { GamePreview } from "../lib/previewData";
import { renderPreviewImage } from "../lib/previewImage";
import {
  cardFor,
  createPreviewImageRouter,
  gameCard,
  type PreviewLoaders,
  profileCard,
  tournamentCard,
} from "../routes/previewImage.routes";

const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);

const game: GamePreview = {
  gameId: "ABC234",
  status: "finished",
  boardSize: 13,
  scoreToWin: 5,
  score: { white: 5, black: 3 },
  white: "alice",
  black: "bob",
  timeControl: null,
  roomType: "direct",
};

const loaders = (calls: string[] = []): PreviewLoaders => ({
  game: async (id) => {
    calls.push(`game:${id}`);
    return id === "ABC234" ? game : null;
  },
  profile: async (name) => {
    calls.push(`profile:${name}`);
    return name === "alice" ? { displayName: "Alice", rating: 1612, gamesPlayed: 40 } : null;
  },
  tournament: async (id) => {
    calls.push(`tournament:${id}`);
    return id === "T1" ? { name: "Autumn Cup", format: "round-robin", playerCount: 8 } : null;
  },
});

describe("preview cards", () => {
  test("describe a game, a profile and a tournament", () => {
    assert.deepEqual(gameCard("abc234", game), {
      eyebrow: "Game invite",
      title: "alice vs bob",
      subtitle: "Final score 5-3. Review this completed Tiao match.",
      meta: ["Game ABC234", "13x13", "5 captures"],
    });
    assert.equal(gameCard("abc234", { ...game, status: "active" }).eyebrow, "Live match");
    assert.equal(gameCard("XYZ789", null).title, "Tiao Game XYZ789");
    assert.deepEqual(
      profileCard("alice", { displayName: "Alice", rating: 1612, gamesPlayed: 40 }).meta,
      ["1612 rating", "40 games", "Badges"],
    );
    assert.equal(profileCard("ghost", null).title, "ghost on Tiao");
    assert.equal(
      tournamentCard("T1", { name: "Autumn Cup", format: "round-robin", playerCount: 8 }).subtitle,
      "8 players competing in a Round Robin event. Join, follow standings, or review matches.",
    );
    assert.equal(tournamentCard("T9", null).title, "Tiao Tournament");
  });

  test("refuse ids the routes could never hold, without a lookup", async () => {
    const calls: string[] = [];
    assert.equal(await cardFor("game", "nope!", loaders(calls)), null);
    assert.equal(await cardFor("tournament", "../x", loaders(calls)), null);
    assert.equal(await cardFor("profile", "x".repeat(65), loaders(calls)), null);
    assert.equal(await cardFor("badge", "x", loaders(calls)), null);
    assert.deepEqual(calls, []);
  });
});

async function withServer(router: express.Router, run: (base: string) => Promise<void>) {
  const app = express();
  app.use("/", router);
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("GET /api/og/:kind/:id.jpg", () => {
  test("serves a cacheable JPEG and renders each link once a minute", async () => {
    const calls: string[] = [];
    let renders = 0;
    const render = async () => {
      renders++;
      return JPEG_START;
    };
    await withServer(createPreviewImageRouter(loaders(calls), render), async (base) => {
      for (const path of ["/api/og/game/ABC234.jpg", "/og/game/abc234.jpg"]) {
        const res = await fetch(base + path);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "image/jpeg");
        assert.equal(res.headers.get("cache-control"), "public, max-age=300, s-maxage=300");
      }
      // An unknown profile still gets a card.
      assert.equal((await fetch(`${base}/api/og/profile/ghost.jpg`)).status, 200);
      assert.equal((await fetch(`${base}/api/og/game/ABC234.png`)).status, 200);
      assert.equal((await fetch(`${base}/api/og/game/ABC234.gif`)).status, 404);
      assert.equal((await fetch(`${base}/api/og/badge/x.jpg`)).status, 404);
    });
    assert.equal(renders, 2);
    assert.deepEqual(calls, ["game:ABC234", "profile:ghost"]);
  });

  test("renders a real 1200x630 JPEG small enough for WhatsApp", async () => {
    const jpeg = await renderPreviewImage(gameCard("ABC234", game));
    assert.deepEqual(jpeg.subarray(0, 3), JPEG_START);
    assert.ok(jpeg.length < 300_000, `${jpeg.length} bytes`);
    const { Jimp } = await import("jimp");
    const image = await Jimp.read(jpeg);
    assert.equal(image.width, 1200);
    assert.equal(image.height, 630);
  });
});
