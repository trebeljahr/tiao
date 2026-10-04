/** Isolated production-path proof. Requires built server, Docker Redis and mongod. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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
const lobbyEvidence = [];
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
  // The auth service rate-limits anonymous sign-ins per address; wait it out.
  for (let attempt = 0; attempt < 30; attempt++) {
    const probe = await fetch(endpoint + "/api/auth/sign-in/anonymous", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(3000),
    });
    if (probe.status !== 429) {
      assert.ok(probe.ok, `sign-in status ${probe.status}`);
      return signedIn(probe);
    }
    await sleep(1000);
  }
  throw new Error("Synthetic sign-in stayed rate limited");
}
async function signedIn(response) {
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
async function lobby(endpoint, cookie, message) {
  const socket = new WebSocket(endpoint.replace("http", "ws") + "/api/ws/lobby", {
    headers: { origin, cookie },
  });
  const received = [];
  lobbyEvidence.push(received);
  socket.on("message", (raw) => received.push(JSON.parse(raw.toString())));
  socket.on("error", () => undefined);
  sockets.push(socket);
  await once(socket, "open");
  // Deliberately send before async auth has finished, like real browsers.
  if (message) socket.send(JSON.stringify(message));
  await deadline(
    () => received.some((row) => row.type === "matchmaking:state"),
    "authenticated lobby state",
  );
  return {
    socket,
    received,
    state: () => received.findLast((row) => row.type === "matchmaking:state")?.state,
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
  await deadline(async () => {
    const candidate = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 2000 });
    try {
      await candidate.connect();
      await candidate.db().command({ ping: 1 });
      mongo = candidate;
      return true;
    } catch {
      await candidate.close();
      return false;
    }
  }, "fixture Mongo");
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

  const [seeker, opponent, queued] = await Promise.all([
    signIn(endpoints[0]),
    signIn(endpoints[1]),
    signIn(endpoints[0]),
  ]);
  const search = { type: "matchmaking:enter-v2", timeControl: null, attemptId: randomUUID() };
  const oldSearch = await lobby(endpoints[0], seeker.cookie, search);
  await deadline(
    () => oldSearch.state()?.status === "searching",
    "early message survives authentication",
  );
  const newSearch = await lobby(endpoints[1], seeker.cookie, search);
  await deadline(
    () => newSearch.state()?.status === "searching",
    "search transferred to another replica",
  );
  await deadline(
    () => oldSearch.received.some((row) => row.type === "matchmaking:preempted"),
    "old replica search preempted",
  );
  oldSearch.socket.close();
  await once(oldSearch.socket, "close");
  await sleep(150);
  const queuedEntries = (await redis.zrange("tiao:matchmaking:queue", 0, -1)).map(JSON.parse);
  assert.equal(queuedEntries.filter((row) => row.player.playerId === seeker.user.id).length, 1);
  const partner = await lobby(endpoints[0], opponent.cookie, {
    ...search,
    attemptId: randomUUID(),
  });
  await deadline(() => partner.state()?.status === "matched", "cross-replica matchmaking");
  await deadline(
    () => newSearch.received.some((row) => row.type === "matchmaking:matched"),
    "waiting replica receives matched reply",
  );
  const matchedRoom = partner.state().snapshot.gameId;
  // Erase only this synthetic pointer: Mongo's search receipt must recover a
  // committed match even if the Redis acknowledgement was lost completely.
  await redis.del(`tiao:matchmaking:match:${seeker.user.id}`);
  newSearch.socket.close();
  await once(newSearch.socket, "close");
  const retry = await lobby(endpoints[1], seeker.cookie, search);
  await deadline(() => retry.state()?.status === "matched", "same search recovers committed match");
  assert.equal(retry.state().snapshot.gameId, matchedRoom);
  assert.equal(
    await mongo
      .db()
      .collection("gamerooms")
      .countDocuments({ matchmakingAttemptIds: `${seeker.user.id}:${search.attemptId}` }),
    1,
  );
  retry.socket.send(
    JSON.stringify({ ...search, timeControl: { initialMs: 1000, incrementMs: 0 } }),
  );
  await deadline(
    () =>
      retry.received.some(
        (row) => row.type === "matchmaking:error" && row.code === "SEARCH_ID_REUSED",
      ),
    "changed retry input refused",
  );
  report.checks.push(
    "socket auth buffer, remote search ownership, stale close, and durable matched-reply recovery",
  );
  // End earlier lobby sessions before testing the independent queued search.
  for (const completed of [partner, retry]) {
    completed.socket.close();
    await once(completed.socket, "close");
  }
  const queuedSearch = { type: "matchmaking:enter-v2", timeControl: null, attemptId: randomUUID() };
  const beforeDrainSearch = await lobby(endpoints[0], queued.cookie, queuedSearch);
  await deadline(
    () => beforeDrainSearch.state()?.status === "searching",
    "search queued before retirement",
  );

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
  const { RedisMatchmakingStore } = require(
    resolve(root, "server/dist/server/game/matchmakingStore.js"),
  );
  const delayedWriter = redis.duplicate();
  await deadline(() => delayedWriter.status === "ready", "delayed Redis writer");
  const originalEval = delayedWriter.eval.bind(delayedWriter);
  delayedWriter.eval = async (...args) => {
    await redis.set("tiao:lock:matchmaking", "successor", "PX", 2000);
    return originalEval(...args);
  };
  try {
    await assert.rejects(
      locks.withLock("matchmaking", () =>
        new RedisMatchmakingStore(delayedWriter, true).addToQueue({
          player: { playerId: "stale-writer", displayName: "Synthetic", kind: "guest" },
          queuedAt: Date.now(),
          timeControl: null,
          rating: 1500,
        }),
      ),
      /authority/,
    );
    assert.equal(
      (await new RedisMatchmakingStore(redis).getAllEntries()).some(
        (row) => row.player.playerId === "stale-writer",
      ),
      false,
    );
  } finally {
    delayedWriter.disconnect();
    await redis.del("tiao:lock:matchmaking");
  }
  report.checks.push("Redis queue mutation atomically rejects a lease lost after preflight");
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
  const pausedPresence = new RedisRoomPresence(redis, 120);
  let resnapshots = 0;
  pausedPresence.onRecovery(() => resnapshots++);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 180);
  assert.equal(pausedPresence.isReady(), false);
  await deadline(
    () => resnapshots > 0 && pausedPresence.isReady(),
    "expired presence forces reconnect",
  );
  await pausedPresence.close();
  report.checks.push(
    "event-loop pause past presence TTL forces reconnect before readiness returns",
  );
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

  // A search replaced while its tab was offline must stay retired in Mongo,
  // independent of Redis, so the old tab cannot reclaim the queue later.
  const tabsUser = await signIn(endpoints[0]);
  const offlineSearch = {
    type: "matchmaking:enter-v2",
    timeControl: { initialMs: 420_000, incrementMs: 3000 },
    attemptId: randomUUID(),
  };
  const offlineTab = await lobby(endpoints[0], tabsUser.cookie, offlineSearch);
  await deadline(() => offlineTab.state()?.status === "searching", "offline tab searching");
  offlineTab.socket.close();
  await once(offlineTab.socket, "close");
  const replacementSearch = { ...offlineSearch, attemptId: randomUUID() };
  const replacementTab = await lobby(endpoints[1], tabsUser.cookie, replacementSearch);
  await deadline(() => replacementTab.state()?.status === "searching", "replacement searching");

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

  const resurrected = await lobby(endpoints[0], tabsUser.cookie, offlineSearch);
  await deadline(
    () =>
      resurrected.received.some(
        (row) => row.type === "matchmaking:error" && row.code === "SEARCH_SUPERSEDED",
      ),
    "superseded search refused after Redis restart",
  );
  assert.equal(
    (
      await mongo
        .db()
        .collection("matchmakingsearches")
        .findOne({ _id: `${tabsUser.user.id}:${offlineSearch.attemptId}` })
    )?.status,
    "superseded",
  );
  const resumedReplacement = await lobby(endpoints[1], tabsUser.cookie, replacementSearch);
  await deadline(
    () => resumedReplacement.state()?.status === "searching",
    "replacement search resumes after Redis restart",
  );
  assert.equal(
    (await redis.zrange("tiao:matchmaking:queue", 0, -1))
      .map(JSON.parse)
      .filter((row) => row.player.playerId === tabsUser.user.id)
      .map((row) => row.attemptId)
      .join(),
    `${tabsUser.user.id}:${replacementSearch.attemptId}`,
  );
  resumedReplacement.socket.send(JSON.stringify({ type: "matchmaking:leave" }));
  await deadline(
    async () =>
      !(await redis.zrange("tiao:matchmaking:queue", 0, -1)).some(
        (raw) => JSON.parse(raw).player.playerId === tabsUser.user.id,
      ),
    "replacement search cancelled",
  );
  for (const tab of [resurrected, resumedReplacement]) {
    tab.socket.close();
    await once(tab.socket, "close");
  }
  report.checks.push("superseded search id stays retired across Redis restart; successor resumes");

  const searchAfterRedis = await lobby(endpoints[0], queued.cookie, queuedSearch);
  await deadline(
    () => searchAfterRedis.state()?.status === "searching",
    "search resumes after Redis gap",
  );

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
  assert.ok(
    report.drainMs >= 20_000 && report.drainMs < 25_000,
    "drain proof excludes host sleep and stalled cleanup",
  );
  clearInterval(sampleTimer);
  assert.equal(report.httpFailures, 0);
  assert.ok(report.httpSamples > 100);
  report.checks.push("20-second drain preserves match and routes clients to surviving replica");
  await deadline(
    () => searchAfterRedis.socket.readyState === WebSocket.CLOSED,
    "queued search old transport retired",
  );
  report.postRetirementMatchLeaseMs = await redis.pttl("tiao:lock:matchmaking");
  const resumedSearch = await lobby(endpoints[1], queued.cookie, queuedSearch);
  await deadline(
    () => resumedSearch.state()?.status === "searching",
    "queued search resumes on survivor",
  );
  const replacementOpponent = await signIn(endpoints[1]);
  const replacement = await lobby(endpoints[1], replacementOpponent.cookie, {
    ...queuedSearch,
    attemptId: randomUUID(),
  });
  await deadline(
    () => replacement.state()?.status === "matched",
    "resumed search matches on survivor",
  );
  await deadline(
    () => resumedSearch.received.some((row) => row.type === "matchmaking:matched"),
    "resumed search receives match",
  );
  assert.equal(
    await mongo
      .db()
      .collection("gamerooms")
      .countDocuments({ matchmakingAttemptIds: `${queued.user.id}:${queuedSearch.attemptId}` }),
    1,
  );
  report.checks.push(
    "queued browser intent survives Redis recovery and server retirement without duplicate games",
  );
  const schedules = await redis.zcard("bull:tiao-matchmaking-sweep:repeat");
  assert.ok(schedules > 0, "retired replica did not remove shared sweep schedule");
  report.checks.push("retirement preserves shared matchmaking schedule");
  await writeFile(resolve(work, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, evidenceDirectory: work }));
} catch (error) {
  await writeFile(
    resolve(work, "failure.json"),
    JSON.stringify(
      {
        ...report,
        lobbyEvents: lobbyEvidence.map((rows) =>
          rows.map((row) => ({
            type: row.type,
            code: row.code,
            status: row.state?.status,
            gameId: row.snapshot?.gameId ?? row.state?.snapshot?.gameId,
          })),
        ),
      },
      null,
      2,
    ),
  );
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
