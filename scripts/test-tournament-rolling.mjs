/** Synthetic real Redis + Mongo proof for durable tournament recovery. Requires built server. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "server/package.json"));
const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
const work = await mkdtemp(resolve(tmpdir(), "tiao-tournament-proof-"));
const name = `tiao-tournament-${process.pid}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function eventually(check, label) {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    try {
      if (await check()) return;
    } catch {}
    await sleep(40);
  }
  throw new Error(`Timed out: ${label}`);
}
async function freePort() {
  for (let i = 0; i < 3; i++) {
    const port = 49152 + Math.floor(Math.random() * 16000);
    const probe = createServer();
    try {
      await new Promise((done, fail) => {
        probe.once("error", fail);
        probe.listen(port, "127.0.0.1", done);
      });
    } catch {
      continue;
    }
    await new Promise((done) => probe.close(done));
    return port;
  }
  throw new Error("No free synthetic fixture port");
}
const redisPort = await freePort();
let mongoPort = await freePort();
while (mongoPort === redisPort) mongoPort = await freePort();
let mongoProcess, mongoose;
const redisClients = [],
  services = [],
  games = [];
const checks = [];
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
      "96m",
      "--cpus",
      "0.5",
      "-p",
      `127.0.0.1:${redisPort}:6379`,
      "redis:7-alpine",
      "redis-server",
      "--save",
      "",
      "--appendonly",
      "no",
    ],
    { stdio: "pipe" },
  );
  const log = createWriteStream(resolve(work, "mongo.log"));
  mongoProcess = spawn(
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
    { cwd: work, env: baseEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  mongoProcess.stdout.pipe(log);
  mongoProcess.stderr.pipe(log);
  mongoProcess.on("error", () => undefined);
  // Do not load repository dotenv files or inherited provider credentials.
  process.chdir(work);
  process.env = { ...baseEnv, NODE_ENV: "test" };
  const Redis = require("ioredis");
  for (let i = 0; i < 2; i++) {
    const redis = new Redis(`redis://127.0.0.1:${redisPort}`, {
      enableOfflineQueue: false,
      commandTimeout: 2000,
      maxRetriesPerRequest: 1,
    });
    redis.on("error", () => undefined);
    redisClients.push(redis);
  }
  await eventually(() => redisClients.every((r) => r.status === "ready"), "Redis readiness");
  mongoose = require("mongoose");
  await eventually(async () => {
    await mongoose.connect(`mongodb://127.0.0.1:${mongoPort}/tournament_synthetic`, {
      serverSelectionTimeoutMS: 700,
    });
    return true;
  }, "Mongo readiness");
  const load = (file) => require(resolve(root, `server/dist/server/${file}.js`));
  const { MongoTournamentStore, claimTournamentAuthority } = load("game/tournamentStore");
  const { MongoGameRoomStore } = load("game/gameStore");
  const { RedisLockProvider } = load("game/lockProvider");
  const { withLockLease, withoutLockLeases } = load("game/lockContext");
  const { TournamentService } = load("game/tournamentService");
  const gameModule = load("game/gameService");
  games.push(gameModule.gameService);
  const Tournament = load("models/Tournament").default;
  const GameRoom = load("models/GameRoom").default;
  const Achievement = load("models/Achievement").default;
  await Promise.all([Tournament.init(), GameRoom.init(), Achievement.init()]);
  class FaultStore extends MongoTournamentStore {
    failLink = false;
    async saveTournament(t) {
      if (this.failLink && t.rounds.some((r) => r.matches.some((m) => m.roomId))) {
        this.failLink = false;
        throw new Error("Synthetic worker died before room-link commit");
      }
      return super.saveTournament(t);
    }
  }
  const storeA = new FaultStore(),
    storeB = new MongoTournamentStore();
  const roomStore = new MongoGameRoomStore();
  const lockA = new RedisLockProvider(redisClients[0], {
    ttlMs: 300,
    retryMs: 20,
    claim: claimTournamentAuthority,
  });
  const lockB = new RedisLockProvider(redisClients[1], {
    ttlMs: 300,
    retryMs: 20,
    claim: claimTournamentAuthority,
  });
  const createService = (store, locks) => {
    const game = new gameModule.GameService(roomStore, () => 0);
    games.push(game);
    const service = new TournamentService(store, game, locks);
    services.push(service);
    return service;
  };
  const a = createService(storeA, lockA),
    b = createService(storeB, lockB);
  const players = Array.from({ length: 4 }, (_, i) => ({
    playerId: new mongoose.Types.ObjectId().toHexString(),
    displayName: `Synthetic ${i}`,
    kind: "account",
  }));
  const GameAccount = load("models/GameAccount").default;
  await GameAccount.create(players.map((p) => ({ _id: p.playerId, displayName: p.displayName })));
  const settings = {
    format: "single-elimination",
    visibility: "private",
    inviteCode: "synthetic",
    minPlayers: 2,
    maxPlayers: 16,
    timeControl: null,
    scheduling: "simultaneous",
    noShow: { type: "auto-forfeit", timeoutMs: 60_000 },
  };
  const created = await a.createTournament(players[0], settings, "Synthetic durability");
  const id = created.tournamentId;
  await Promise.all(players.map((p, i) => (i % 2 ? a : b).registerPlayer(id, p, "synthetic")));
  await Promise.all([
    a.accessTournament(id, "invited-a", "synthetic"),
    b.accessTournament(id, "invited-b", "synthetic"),
  ]);
  assert.deepEqual((await storeB.getTournament(id)).invitedUserIds.sort(), [
    "invited-a",
    "invited-b",
  ]);
  checks.push("cross-replica registration and invites preserve all updates");
  storeA.failLink = true;
  await assert.rejects(a.startTournament(id, players[0].playerId), /Synthetic worker died/);
  assert.equal(await GameRoom.countDocuments({ tournamentId: id }), 1);
  assert.equal(
    (await storeB.getTournament(id)).rounds[0].matches.filter((m) => m.roomId).length,
    0,
  );
  await a.close();
  await b.startRecovery();
  let current = await storeB.getTournament(id);
  assert.equal(current.rounds[0].matches.filter((m) => m.roomId).length, 2);
  assert.equal(await GameRoom.countDocuments({ tournamentId: id }), 2);
  checks.push("worker death after room insert recovers one stable room per match");
  const { forfeitGame } = require(resolve(root, "server/dist/shared/src/index.js"));
  async function finish(roomId) {
    const room = await roomStore.getRoom(roomId);
    const result = forfeitGame(room.state, "black");
    assert.ok(result.ok);
    room.state = result.value;
    room.status = "finished";
    await roomStore.saveRoom(room);
  }
  for (const match of current.rounds[0].matches) await finish(match.roomId);
  await b.recoverPending();
  current = await storeB.getTournament(id);
  assert.equal(current.rounds[0].status, "finished");
  assert.ok(current.rounds[1].matches[0].roomId);
  assert.equal(await GameRoom.countDocuments({ tournamentId: id }), 3);
  await b.recoverPending();
  assert.equal(await GameRoom.countDocuments({ tournamentId: id }), 3);
  await finish(current.rounds[1].matches[0].roomId);
  await b.recoverPending();
  current = await storeB.getTournament(id);
  assert.equal(current.status, "finished");
  assert.equal(current.completionEffectsPending, false);
  assert.equal(await Achievement.countDocuments({ achievementId: "tournament-champion" }), 1);
  await b.onGameCompleted(current.rounds[1].matches[0].roomId);
  assert.equal(await Achievement.countDocuments({ achievementId: "tournament-champion" }), 1);
  const champion = current.participants.find((p) => p.status === "winner").playerId;
  await GameAccount.updateOne({ _id: champion }, { $set: { badges: [] } });
  await lockB.withLock(`tournament:${id}`, async () => {
    const partial = await storeB.getTournament(id);
    partial.completionEffectsPending = true;
    await storeB.saveTournament(partial);
  });
  await b.recoverPending();
  assert.ok((await GameAccount.findById(champion).lean()).badges.includes("tournament-champion"));
  assert.equal(await Achievement.countDocuments({ achievementId: "tournament-champion" }), 1);
  checks.push("lost completion callbacks advance bracket once and persist champion achievement");

  // The document fence rejects an old writer even when its lease checker is
  // deliberately stubbed as current, independently of Redis lease rejection.
  await claimTournamentAuthority(`tournament:${id}`, "old-synthetic-token");
  const stale = await storeB.getTournament(id);
  await claimTournamentAuthority(`tournament:${id}`, "new-synthetic-token");
  await withLockLease(
    { key: `tournament:${id}`, token: "old-synthetic-token", assertCurrent: async () => {} },
    async () => {
      await assert.rejects(storeA.saveTournament(stale), /changed/);
      await assert.rejects(storeA.deleteTournament(id, stale), /changed/);
    },
  );
  let stolen;
  await assert.rejects(
    lockA.withLock(`tournament:${id}`, async () => {
      stolen = await storeA.getTournament(id);
      await redisClients[1].del(`tiao:lock:tournament:${id}`);
      await withoutLockLeases(() =>
        lockB.withLock(`tournament:${id}`, async () => {
          const fresh = await storeB.getTournament(id);
          fresh.name = "New owner";
          await storeB.saveTournament(fresh);
        }),
      );
      await storeA.saveTournament(stolen);
    }),
    /lease/,
  );
  assert.equal((await storeB.getTournament(id)).name, "New owner");
  checks.push("Mongo token/revision fence and replaced Redis lease refuse stale save/delete");

  const cancel = await b.createTournament(players[0], settings, "Synthetic cancellation");
  await b.registerPlayer(cancel.tournamentId, players[0], "synthetic");
  await b.registerPlayer(cancel.tournamentId, players[1], "synthetic");
  const started = await b.startTournament(cancel.tournamentId, players[0].playerId);
  const gameB = games.at(-1),
    unlink = gameB.unlinkTournamentGames.bind(gameB);
  gameB.unlinkTournamentGames = async () => {
    throw new Error("Synthetic interruption before cleanup");
  };
  await assert.rejects(
    b.cancelTournament(cancel.tournamentId, players[0].playerId),
    /Synthetic interruption/,
  );
  assert.equal((await storeB.getTournament(cancel.tournamentId)).cleanupPending, true);
  gameB.unlinkTournamentGames = unlink;
  const oldRoom = await roomStore.getRoom(started.rounds[0].matches[0].roomId);
  await b.recoverPending();
  assert.equal((await storeB.getTournament(cancel.tournamentId)).cleanupPending, false);
  await assert.rejects(roomStore.saveRoom(oldRoom), /changed/);
  await b.onGameCompleted(oldRoom.id);
  assert.equal((await storeB.getTournament(cancel.tournamentId)).status, "cancelled");
  assert.equal(await GameRoom.countDocuments({ tournamentId: cancel.tournamentId }), 0);
  await b.deleteTournament(cancel.tournamentId, players[0].playerId);
  assert.equal(await storeB.getTournament(cancel.tournamentId), null);
  // Model a delayed old insert arriving after user deletion and its cleanup.
  await GameRoom.updateOne(
    { roomId: oldRoom.id },
    { $set: { tournamentId: cancel.tournamentId, tournamentMatchId: "late-synthetic" } },
  );
  await b.recoverPending();
  assert.equal(await GameRoom.countDocuments({ tournamentId: cancel.tournamentId }), 0);
  checks.push(
    "cancellation survives cleanup interruption and stale room writes cannot restore links",
  );
  const drawn = await b.createTournament(
    players[0],
    { ...settings, format: "round-robin" },
    "Synthetic draw",
  );
  await b.registerPlayer(drawn.tournamentId, players[0], "synthetic");
  await b.registerPlayer(drawn.tournamentId, players[1], "synthetic");
  const drawStart = await b.startTournament(drawn.tournamentId, players[0].playerId);
  const drawRoom = await roomStore.getRoom(drawStart.rounds[0].matches[0].roomId);
  drawRoom.state.history.push({ type: "draw" });
  drawRoom.status = "finished";
  await roomStore.saveRoom(drawRoom);
  await b.recoverPending();
  const drawEnd = await storeB.getTournament(drawn.tournamentId);
  assert.equal(drawEnd.status, "finished");
  assert.equal(drawEnd.rounds[0].matches[0].winner, null);
  assert.equal(drawEnd.rounds[0].matches[0].finishReason, "board_full");
  checks.push("draw results persist in Mongo and recover without inventing winners");
  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  await Promise.allSettled(services.map((s) => s.close()));
  await Promise.allSettled(games.map((g) => g.close()));
  for (const redis of redisClients) redis.disconnect();
  await mongoose?.disconnect();
  if (mongoProcess && mongoProcess.exitCode === null && mongoProcess.signalCode === null) {
    mongoProcess.kill("SIGTERM");
    const timer = setTimeout(() => mongoProcess.kill("SIGKILL"), 5000);
    await once(mongoProcess, "exit");
    clearTimeout(timer);
  }
  try {
    execFileSync("docker", ["rm", "-f", name], { stdio: "pipe" });
  } catch {}
  process.chdir(root);
  await rm(work, { recursive: true, force: true });
}
