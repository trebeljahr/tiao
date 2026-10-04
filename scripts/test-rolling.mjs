/** Isolated production-path proof. Requires built server, Docker Redis and mongod. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "server/package.json"));
const { WebSocket } = require("ws");
const Redis = require("ioredis");
const { MongoClient } = require("mongodb");
const { canPlacePiece } = require(resolve(root, "server/dist/shared/src/index.js"));
const legalPlacement = (state) => {
  for (let y = 0; y < state.boardSize; y++)
    for (let x = 0; x < state.boardSize; x++)
      if (canPlacePiece(state, { x, y }).ok) return { x, y };
  throw new Error("Synthetic game has no legal placement");
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const deadline = async (check, label, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await check()) return;
    } catch {}
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
};
const freePort = async () => {
  for (;;) {
    const port = 49_152 + Math.floor(Math.random() * 16_000);
    const server = createServer();
    try {
      await new Promise((done, fail) => {
        server.once("error", fail);
        server.listen(port, "127.0.0.1", done);
      });
    } catch {
      continue;
    }
    await new Promise((done) => server.close(done));
    return port;
  }
};
const work = await mkdtemp(resolve(tmpdir(), "tiao-rolling-proof-"));
const ports = await Promise.all(Array.from({ length: 4 }, freePort));
const [redisPort, mongoPort, portA, portB] = ports;
const name = `tiao-rolling-${process.pid}`;
const children = [];
const sockets = [];
const endpoints = [`http://127.0.0.1:${portA}`, `http://127.0.0.1:${portB}`];
const origin = endpoints[0];
const mongoUrl = `mongodb://127.0.0.1:${mongoPort}/tiao_rolling_synthetic`;
let redis, mongo, mongoose;
let sampleTimer;
const report = { protocol: 2, httpSamples: 0, httpFailures: 0, checks: [], drainMs: 0 };
function launch(label, executable, args, env) {
  const log = createWriteStream(resolve(work, `${label}.log`));
  const child = spawn(executable, args, { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on("error", () => undefined);
  children.push(child);
  return child;
}
async function closeChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 32_000);
  await once(child, "exit");
  clearTimeout(timer);
}
async function request(endpoint, path, cookie, body) {
  const response = await fetch(endpoint + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  assert.ok(
    response.ok,
    `${path} status ${response.status}: ${(await response.clone().text()).slice(0, 200)}`,
  );
  return response;
}
async function signIn(endpoint) {
  const response = await request(endpoint, "/api/auth/sign-in/anonymous", undefined, {});
  const cookies = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookies);
  return { cookie: cookies, user: (await response.json()).user };
}
async function connect(endpoint, gameId, cookie) {
  const socket = new WebSocket(endpoint.replace("http", "ws") + `/ws?gameId=${gameId}`, {
    headers: { origin, cookie },
  });
  const received = [];
  socket.on("message", (raw) => {
    received.push(JSON.parse(raw.toString()));
  });
  socket.on("error", () => undefined);
  sockets.push(socket);
  await once(socket, "open");
  await deadline(
    () => received.some((message) => message.type === "snapshot"),
    "initial socket snapshot",
  );
  return {
    socket,
    received,
    snapshot: () => received.findLast((message) => message.type === "snapshot")?.snapshot,
  };
}
try {
  await mkdir(resolve(work, "mongo"));
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--memory",
      "128m",
      "--cpus",
      "0.5",
      "-p",
      `127.0.0.1:${redisPort}:6379`,
      "redis:7-alpine",
      "redis-server",
      "--save",
      "",
      "--appendonly",
      "yes",
    ],
    { stdio: "pipe" },
  );
  const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
  launch(
    "mongo",
    "mongod",
    [
      "--bind_ip",
      "127.0.0.1",
      "--port",
      String(mongoPort),
      "--dbpath",
      resolve(work, "mongo"),
      "--wiredTigerCacheSizeGB",
      "0.25",
      "--quiet",
    ],
    baseEnv,
  );
  redis = new Redis(`redis://127.0.0.1:${redisPort}`, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 2000,
  });
  redis.on("error", () => undefined);
  await deadline(() => redis.ping(), "fixture Redis");
  mongo = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 1000 });
  await deadline(() => mongo.db().command({ ping: 1 }), "fixture Mongo");
  const appEnv = {
    ...baseEnv,
    NODE_ENV: "production",
    TOKEN_SECRET: "synthetic-rolling-test-secret-not-a-live-credential",
    BETTER_AUTH_SECRET: "synthetic-rolling-test-secret-not-a-live-credential",
    MONGODB_URI: mongoUrl,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    FRONTEND_URL: origin,
    S3_BUCKET_NAME: "synthetic",
    S3_PUBLIC_URL: "https://assets.example.invalid",
    NODE_OPTIONS: "--max-old-space-size=512",
  };
  const apps = ports.slice(2).map((port, index) =>
    launch(`server-${index}`, process.execPath, [resolve(root, "server/dist/server/index.js")], {
      ...appEnv,
      PORT: String(port),
      BETTER_AUTH_URL: endpoints[index],
    }),
  );
  for (const endpoint of endpoints)
    await deadline(
      async () => (await fetch(endpoint + "/health")).status === 200,
      `healthy ${endpoint}`,
      25_000,
    );
  const [alice, bob] = await Promise.all(endpoints.map(signIn));
  const created = await (
    await request(endpoints[0], "/games", alice.cookie, { creatorColor: "white" })
  ).json();
  const gameId = created.snapshot.gameId;
  await request(endpoints[1], `/games/${gameId}/join`, bob.cookie, {});
  const a = await connect(endpoints[0], gameId, alice.cookie);
  const b = await connect(endpoints[1], gameId, bob.cookie);
  await deadline(
    () =>
      a.snapshot()?.players.every((player) => player.online) &&
      b.snapshot()?.players.every((player) => player.online),
    "shared cross-replica presence",
  );
  report.checks.push("both players online across replicas");
  a.socket.send(
    JSON.stringify({ type: "place-piece", position: legalPlacement(a.snapshot().state) }),
  );
  await deadline(() => b.snapshot()?.state.history.length === 1, "cross-replica move fanout").catch(
    (error) => {
      console.error(
        JSON.stringify({
          errorsA: a.received.filter((x) => x.type === "error"),
          errorsB: b.received.filter((x) => x.type === "error"),
          stateA: a.snapshot()?.state,
          seats: a.snapshot()?.seats,
        }),
      );
      throw error;
    },
  );
  report.checks.push("remote move snapshot");

  // Leases renew beyond their original TTL. Mongo authority independently
  // rejects a delayed old-token write even before the new owner saves state.
  process.chdir(work);
  process.env = { ...baseEnv, NODE_ENV: "test", MONGODB_URI: mongoUrl };
  mongoose = require("mongoose");
  await mongoose.connect(mongoUrl);
  const { RedisLockProvider } = require(resolve(root, "server/dist/server/game/lockProvider.js"));
  const { MongoGameRoomStore, claimRoomAuthority } = require(
    resolve(root, "server/dist/server/game/gameStore.js"),
  );
  const { assertCurrentLocks } = require(resolve(root, "server/dist/server/game/lockContext.js"));
  const { RedisRoomPresence } = require(resolve(root, "server/dist/server/game/presence.js"));
  const { GameService } = require(resolve(root, "server/dist/server/game/gameService.js"));
  const store = new MongoGameRoomStore();
  const locks = new RedisLockProvider(redis, {
    ttlMs: 300,
    retryMs: 30,
    claim: claimRoomAuthority,
  });
  let inside = 0,
    peak = 0;
  await Promise.all(
    [0, 1].map(() =>
      locks.withLock("proof-renew", async () => {
        peak = Math.max(peak, ++inside);
        await sleep(850);
        inside--;
      }),
    ),
  );
  assert.equal(peak, 1);
  report.checks.push("renewed lease serializes operations exceeding original TTL");
  await assert.rejects(
    locks.withLock("proof-lost", async () => {
      await redis.set("tiao:lock:proof-lost", "successor", "PX", 2000);
      await assertCurrentLocks();
    }),
    /lease/,
  );
  assert.equal(await redis.get("tiao:lock:proof-lost"), "successor");
  await redis.del("tiao:lock:proof-lost");
  report.checks.push("lost lease rejects work and cannot release its successor");
  const sharedPresence = new RedisRoomPresence(redis);
  const expiryService = new GameService(
    store,
    Math.random,
    50,
    undefined,
    locks,
    undefined,
    undefined,
    undefined,
    sharedPresence,
  );
  await expiryService.handleAbandonExpired(gameId, bob.user.id);
  assert.equal((await store.getRoom(gameId)).status, "active");
  await expiryService.close();
  report.checks.push("guest connected to another replica is not forfeited by a timer");
  const crashedRedis = redis.duplicate();
  await deadline(() => crashedRedis.status === "ready", "crash presence connection");
  const crashedPresence = new RedisRoomPresence(crashedRedis, 120);
  const observerPresence = new RedisRoomPresence(redis, 120);
  await crashedPresence.join("crash-connection", "PROOF_CRASH", {
    playerId: "synthetic-guest",
    displayName: "Synthetic",
    kind: "guest",
  });
  assert.equal((await observerPresence.players("PROOF_CRASH")).size, 1);
  crashedRedis.disconnect();
  await sleep(180);
  assert.equal((await observerPresence.players("PROOF_CRASH")).size, 0);
  await crashedPresence.close();
  await observerPresence.close();
  report.checks.push("crashed connection presence expires without removing other replica leases");
  let stale;
  await locks.withLock(`room:${gameId}`, async () => {
    stale = await store.getRoom(gameId);
  });
  await locks.withLock(`room:${gameId}`, async () => {
    await assert.rejects(store.saveRoom(stale), /authority/);
    const result = await mongo
      .db()
      .collection("gamerooms")
      .updateOne(
        { roomId: gameId, authorityToken: stale.authorityToken, revision: stale.revision },
        { $set: { status: "finished" } },
      );
    assert.equal(result.matchedCount, 0);
  });
  assert.equal((await store.getRoom(gameId)).status, "active");
  await mongoose.disconnect();
  report.checks.push("Mongo token fences delayed stale owner before successor state write");

  const recoveryAt = Date.now();
  execFileSync("docker", ["restart", name], { stdio: "pipe" });
  await deadline(
    () => a.socket.readyState === WebSocket.CLOSED && b.socket.readyState === WebSocket.CLOSED,
    "Redis gap closes stale sockets",
  );
  for (const endpoint of endpoints)
    await deadline(
      async () => (await fetch(endpoint + "/health")).status === 200,
      "Redis readiness recovery",
    );
  const reA = await connect(endpoints[0], gameId, alice.cookie);
  const reB = await connect(endpoints[1], gameId, bob.cookie);
  assert.equal(reA.snapshot().state.history.length, 1);
  assert.equal(reB.snapshot().state.history.length, 1);
  report.redisRecoveryMs = Date.now() - recoveryAt;
  report.checks.push("Redis loss forces reconnect and authoritative resnapshot");

  let sampling = false;
  sampleTimer = setInterval(async () => {
    if (sampling) return;
    sampling = true;
    try {
      const response = await fetch(endpoints[1] + "/health", { signal: AbortSignal.timeout(1500) });
      report.httpSamples++;
      if (response.status !== 200) report.httpFailures++;
    } catch {
      report.httpFailures++;
    } finally {
      sampling = false;
    }
  }, 75);
  const drainAt = Date.now();
  apps[0].kill("SIGTERM");
  await deadline(
    async () => (await fetch(endpoints[0] + "/health")).status === 503,
    "old replica draining",
  );
  reB.socket.send(
    JSON.stringify({ type: "place-piece", position: legalPlacement(reB.snapshot().state) }),
  );
  await deadline(
    () => reA.snapshot()?.state.history.length === 2 && reB.snapshot()?.state.history.length === 2,
    "match advances during drain",
  );
  await deadline(() => reA.socket.readyState === WebSocket.CLOSED, "old socket retired", 25_000);
  const switched = await connect(endpoints[1], gameId, alice.cookie);
  assert.equal(switched.snapshot().state.history.length, 2);
  await deadline(() => apps[0].exitCode !== null, "old process exits cleanly", 12_000);
  report.drainMs = Date.now() - drainAt;
  assert.equal(apps[0].exitCode, 0);
  clearInterval(sampleTimer);
  assert.equal(report.httpFailures, 0);
  assert.ok(report.httpSamples > 100);
  report.checks.push("20-second drain preserves match and routes clients to surviving replica");
  const schedules = await redis.zcard("bull:tiao-matchmaking-sweep:repeat");
  assert.ok(schedules > 0, "retired replica did not remove shared sweep schedule");
  report.checks.push("retirement preserves shared matchmaking schedule");
  await writeFile(resolve(work, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, evidenceDirectory: work }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Fixture failed");
  throw error;
} finally {
  clearInterval(sampleTimer);
  for (const socket of sockets) socket.terminate();
  await Promise.all(children.slice(1).map(closeChild));
  if (children[0]) await closeChild(children[0]);
  redis?.disconnect();
  await mongoose?.disconnect();
  await mongo?.close();
  try {
    execFileSync("docker", ["rm", "-f", name], { stdio: "pipe" });
  } catch {}
  await rm(resolve(work, "mongo"), { recursive: true, force: true });
}
