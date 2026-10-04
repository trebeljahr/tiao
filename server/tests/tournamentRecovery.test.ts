import assert from "node:assert/strict";
import { before, test } from "node:test";
import { forfeitGame, type PlayerIdentity, type TournamentSettings } from "../../shared/src";
import { GameService } from "../game/gameService";
import { InMemoryGameRoomStore } from "../game/gameStore";
import { InMemoryLockProvider } from "../game/lockProvider";
import { TournamentService } from "../game/tournamentService";
import { InMemoryTournamentStore } from "../game/tournamentStore";

before(async () => {
  const achievements = (await import("../game/achievementService")) as Record<string, unknown>;
  achievements.onTournamentWon = async () => {};
});
const player = (playerId: string): PlayerIdentity => ({
  playerId,
  displayName: playerId,
  kind: "account",
});
const settings: TournamentSettings = {
  format: "single-elimination",
  timeControl: null,
  scheduling: "simultaneous",
  noShow: { type: "auto-forfeit", timeoutMs: 60_000 },
  visibility: "public",
  minPlayers: 2,
  maxPlayers: 16,
};
function fixture() {
  const store = new InMemoryTournamentStore();
  const rooms = new InMemoryGameRoomStore();
  const locks = new InMemoryLockProvider();
  const games = new GameService(rooms, () => 0);
  const a = new TournamentService(store, games, locks);
  const b = new TournamentService(store, games, locks);
  return { store, rooms, games, a, b };
}
async function active(f: ReturnType<typeof fixture>) {
  const t = await f.a.createTournament(player("alice"), settings, "Synthetic recovery");
  await f.a.registerPlayer(t.tournamentId, player("alice"));
  await f.b.registerPlayer(t.tournamentId, player("bob"));
  return f.a.startTournament(t.tournamentId, "alice");
}

test("independent snapshots prevent uncommitted edits; stale revisions cannot save/delete", async () => {
  const f = fixture();
  const t = await f.a.createTournament(player("alice"), settings, "Synthetic CAS");
  const old = (await f.store.getTournament(t.tournamentId))!;
  old.invitedUserIds.push("uncommitted");
  assert.deepEqual((await f.store.getTournament(t.tournamentId))!.invitedUserIds, []);
  await f.a.registerPlayer(t.tournamentId, player("alice"));
  await assert.rejects(f.store.saveTournament(old), /changed/);
  await assert.rejects(f.store.deleteTournament(t.tournamentId, old), /changed/);
});

test("two workers serialize creator quota and private invites", async () => {
  const f = fixture();
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) =>
      (i % 2 ? f.a : f.b).createTournament(
        player("owner"),
        { ...settings, visibility: "private", inviteCode: "synthetic" },
        `T${i}`,
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 10);
  const t = (await f.store.listAllTournaments())[0];
  await Promise.all([
    f.a.accessTournament(t.tournamentId, "alice", "synthetic"),
    f.b.accessTournament(t.tournamentId, "bob", "synthetic"),
  ]);
  assert.deepEqual((await f.store.getTournament(t.tournamentId))!.invitedUserIds.sort(), [
    "alice",
    "bob",
  ]);
});

test("new worker recovers a committed game whose completion callback was lost", async () => {
  const f = fixture();
  const t = await active(f);
  const room = (await f.rooms.getRoom(t.rounds[0].matches[0].roomId!))!;
  const result = forfeitGame(room.state, "black");
  assert.ok(result.ok);
  room.state = result.value;
  room.status = "finished";
  await f.rooms.saveRoom(room);
  // Persisted game only: deliberately never deliver onGameCompleted.
  await f.b.recoverPending();
  const done = (await f.store.getTournament(t.tournamentId))!;
  assert.equal(done.status, "finished");
  assert.equal(done.completionEffectsPending, false);
  const revision = done.revision;
  await f.a.onGameCompleted(room.id);
  assert.equal((await f.store.getTournament(t.tournamentId))!.revision, revision);
});

test("cancellation commits before cleanup, retries after failure and ignores late game results", async () => {
  const f = fixture();
  const t = await active(f);
  const unlink = f.games.unlinkTournamentGames.bind(f.games);
  let fail = true;
  f.games.unlinkTournamentGames = async (id) => {
    if (fail) throw new Error("synthetic cleanup failure");
    return unlink(id);
  };
  await assert.rejects(f.a.cancelTournament(t.tournamentId, "alice"), /synthetic/);
  const cancelled = (await f.store.getTournament(t.tournamentId))!;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cleanupPending, true);
  const before = structuredClone(cancelled.rounds);
  fail = false;
  await f.b.onGameCompleted(t.rounds[0].matches[0].roomId!);
  const settled = (await f.store.getTournament(t.tournamentId))!;
  assert.equal(settled.cleanupPending, false);
  assert.deepEqual(settled.rounds, before);
  assert.equal(settled.status, "cancelled");
  await f.a.deleteTournament(t.tournamentId, "alice");
  assert.equal(await f.store.getTournament(t.tournamentId), null);
});

test("drain waits for an accepted tournament write, then refuses new writes", async () => {
  const f = fixture();
  const original = f.store.createTournament.bind(f.store);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.store.createTournament = async (t) => {
    entered();
    await hold;
    return original(t);
  };
  const write = f.a.createTournament(player("alice"), settings, "Accepted write");
  await started;
  let closed = false;
  const draining = f.a.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(closed, false);
  await assert.rejects(f.a.createTournament(player("bob"), settings, "Too late"), /draining/);
  release();
  await write;
  await draining;
  assert.equal(closed, true);
});

test("post-commit completion escapes the old room lease", async () => {
  const f = fixture();
  const t = await active(f);
  const room = (await f.rooms.getRoom(t.rounds[0].matches[0].roomId!))!;
  const result = forfeitGame(room.state, "black");
  assert.ok(result.ok);
  room.state = result.value;
  room.status = "finished";
  await f.rooms.saveRoom(room);
  const { withLockLease } = await import("../game/lockContext");
  await withLockLease(
    {
      key: `room:${room.id}`,
      token: "released",
      assertCurrent: async () => {
        throw new Error("Room lease already released");
      },
    },
    () => f.b.onGameCompleted(room.id),
  );
  assert.equal((await f.store.getTournament(t.tournamentId))!.status, "finished");
});

test("round-robin draw recovery completes once without inventing a winner", async () => {
  const f = fixture();
  const t = await f.a.createTournament(
    player("alice"),
    { ...settings, format: "round-robin" },
    "Synthetic draw",
  );
  await f.a.registerPlayer(t.tournamentId, player("alice"));
  await f.a.registerPlayer(t.tournamentId, player("bob"));
  const started = await f.a.startTournament(t.tournamentId, "alice");
  const room = (await f.rooms.getRoom(started.rounds[0].matches[0].roomId!))!;
  room.state.history.push({ type: "draw" });
  room.status = "finished";
  await f.rooms.saveRoom(room);
  await f.b.recoverPending();
  const result = (await f.store.getTournament(t.tournamentId))!;
  assert.equal(result.status, "finished");
  assert.equal(result.rounds[0].matches[0].winner, null);
  assert.equal(result.rounds[0].matches[0].finishReason, "board_full");
});

test("room insertion before failed bracket-link commit is reused on restart", async () => {
  const f = fixture();
  const t = await f.a.createTournament(player("alice"), settings, "Synthetic room link");
  await f.a.registerPlayer(t.tournamentId, player("alice"));
  await f.a.registerPlayer(t.tournamentId, player("bob"));
  const save = f.store.saveTournament.bind(f.store);
  let fail = true;
  let ready = 0;
  f.games.broadcastLobby = (_playerId, event) => {
    if (event.type === "tournament-match-ready") ready++;
  };
  f.store.saveTournament = async (next) => {
    if (fail && next.rounds.some((r) => r.matches.some((m) => m.roomId))) {
      fail = false;
      throw new Error("Synthetic room-link interruption");
    }
    return save(next);
  };
  await assert.rejects(f.a.startTournament(t.tournamentId, "alice"), /Synthetic/);
  assert.equal(ready, 0);
  const before = await f.rooms.listRoomsForPlayer("alice");
  assert.equal(before.length, 1);
  assert.equal((await f.store.getTournament(t.tournamentId))!.rounds[0].matches[0].roomId, null);
  await f.a.close();
  await f.b.recoverPending();
  const recovered = (await f.store.getTournament(t.tournamentId))!;
  assert.equal(recovered.rounds[0].matches[0].roomId, before[0].id);
  assert.equal((await f.rooms.listRoomsForPlayer("alice")).length, 1);
  assert.equal(ready, 2);
});
