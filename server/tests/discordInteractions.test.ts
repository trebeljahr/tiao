process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import express from "express";
import type { DiscordDataSource } from "../discord/commands";
import { parseDiscordPublicKey, verifyDiscordSignature } from "../discord/verify";
import { createDiscordRouter } from "../routes/discord.routes";

// ---------------------------------------------------------------------------
// Key helpers — mimic what Discord does: raw 32-byte Ed25519 key shown as hex
// ---------------------------------------------------------------------------

function makeKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const hex = spki.subarray(spki.length - 32).toString("hex");
  return { privateKey, publicKeyHex: hex };
}

function signRequest(privateKey: KeyObject, timestamp: string, body: string): string {
  return sign(
    null,
    Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]),
    privateKey,
  ).toString("hex");
}

const emptySource: DiscordDataSource = {
  async topPlayers() {
    return [{ displayName: "Alice", elo: 1600, gamesPlayed: 2 }];
  },
  async findPlayerStats() {
    return null;
  },
  async currentPuzzle() {
    return null;
  },
};

describe("verifyDiscordSignature", () => {
  const { privateKey, publicKeyHex } = makeKeyPair();
  const publicKey = parseDiscordPublicKey(publicKeyHex);
  const body = JSON.stringify({ type: 1 });
  const timestamp = "1700000000";

  test("accepts a signature made with the matching private key", () => {
    const signature = signRequest(privateKey, timestamp, body);
    assert.equal(verifyDiscordSignature(publicKey, signature, timestamp, Buffer.from(body)), true);
  });

  test("rejects a tampered body, timestamp, or a foreign key", () => {
    const signature = signRequest(privateKey, timestamp, body);
    assert.equal(
      verifyDiscordSignature(publicKey, signature, timestamp, Buffer.from(`${body} `)),
      false,
    );
    assert.equal(
      verifyDiscordSignature(publicKey, signature, "1700000001", Buffer.from(body)),
      false,
    );

    const other = makeKeyPair();
    const foreign = signRequest(other.privateKey, timestamp, body);
    assert.equal(verifyDiscordSignature(publicKey, foreign, timestamp, Buffer.from(body)), false);
  });

  test("rejects missing or malformed headers without throwing", () => {
    assert.equal(verifyDiscordSignature(publicKey, undefined, timestamp, Buffer.from(body)), false);
    assert.equal(verifyDiscordSignature(publicKey, "abc", timestamp, Buffer.from(body)), false);
    assert.equal(
      verifyDiscordSignature(publicKey, "zz".repeat(64), timestamp, Buffer.from(body)),
      false,
    );
    const signature = signRequest(privateKey, timestamp, body);
    assert.equal(verifyDiscordSignature(publicKey, signature, undefined, Buffer.from(body)), false);
  });

  test("parseDiscordPublicKey validates the hex shape", () => {
    assert.throws(() => parseDiscordPublicKey("not-hex"), /64 hex/);
    assert.throws(() => parseDiscordPublicKey("ab".repeat(31)), /64 hex/);
    assert.ok(parseDiscordPublicKey(`  ${publicKeyHex}  `));
  });
});

describe("POST /discord/interactions", () => {
  const { privateKey, publicKeyHex } = makeKeyPair();
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const app = express();
    app.use(
      "/discord",
      createDiscordRouter({
        publicKey: parseDiscordPublicKey(publicKeyHex),
        dataSource: emptySource,
      }),
    );
    app.use("/unconfigured", createDiscordRouter(null));
    // Mimic app.ts: the global JSON parser comes AFTER the discord router.
    app.use(express.json());
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function post(path: string, body: string, headers: Record<string, string>) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
    return { status: response.status, json: await response.json() };
  }

  function signedHeaders(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
    return {
      "x-signature-ed25519": signRequest(privateKey, timestamp, body),
      "x-signature-timestamp": timestamp,
    };
  }

  test("answers Discord's verification ping with a pong", async () => {
    const body = JSON.stringify({ type: 1 });
    const result = await post("/discord/interactions", body, signedHeaders(body));
    assert.equal(result.status, 200);
    assert.deepEqual(result.json, { type: 1 });
  });

  test("dispatches a signed slash command", async () => {
    const body = JSON.stringify({ type: 2, data: { name: "leaderboard" } });
    const result = await post("/discord/interactions", body, signedHeaders(body));
    assert.equal(result.status, 200);
    assert.equal(result.json.type, 4);
    assert.match(result.json.data.embeds[0].description, /Alice/);
  });

  test("rejects an unsigned request with 401", async () => {
    const body = JSON.stringify({ type: 1 });
    const result = await post("/discord/interactions", body, {});
    assert.equal(result.status, 401);
  });

  test("rejects a request whose body was altered after signing", async () => {
    const original = JSON.stringify({ type: 2, data: { name: "leaderboard" } });
    const tampered = JSON.stringify({ type: 2, data: { name: "puzzle" } });
    const result = await post("/discord/interactions", tampered, signedHeaders(original));
    assert.equal(result.status, 401);
  });

  test("rejects a well-signed but unparsable body with 400", async () => {
    const body = "{ nope";
    const result = await post("/discord/interactions", body, signedHeaders(body));
    assert.equal(result.status, 400);
  });

  test("returns 404 when Discord is not configured", async () => {
    const body = JSON.stringify({ type: 1 });
    const result = await post("/unconfigured/interactions", body, signedHeaders(body));
    assert.equal(result.status, 404);
  });
});
