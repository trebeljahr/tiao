import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlayerIdentity, TournamentSettings } from "../../shared/src";
import { GameService } from "../game/gameService";
import { InMemoryGameRoomStore } from "../game/gameStore";
import { InMemoryLockProvider } from "../game/lockProvider";
import { TournamentService } from "../game/tournamentService";
import { InMemoryTournamentStore } from "../game/tournamentStore";

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
async function fixture() {
  let now = 100_000;
  let unavailable = false;
  const online = new Set(["alice", "bob"]);
  const callbacks: ((playerId: string) => void)[] = [];
  const store = new InMemoryTournamentStore();
  const locks = new InMemoryLockProvider();
  const games = new GameService(new InMemoryGameRoomStore(), () => 0);
  Object.assign(games, {
    isPlayerConnectedToLobby: async (id: string) => {
      if (unavailable) throw new Error("Synthetic presence unavailable");
      return online.has(id);
    },
    onLobbyDisconnect: (cb: (playerId: string) => void) => callbacks.push(cb),
  });
  const a = new TournamentService(store, games, locks, () => now);
  const b = new TournamentService(store, games, locks, () => now);
  const t = await a.createTournament(player("alice"), settings, "Synthetic registration");
  await a.registerPlayer(t.tournamentId, player("alice"));
  await a.registerPlayer(t.tournamentId, player("bob"));
  return {
    a,
    b,
    games,
    store,
    locks,
    now: () => now,
    online,
    callbacks,
    id: t.tournamentId,
    read: async () => (await store.getTournament(t.tournamentId))!,
    advance: (ms: number) => {
      now += ms;
    },
    failPresence: (value: boolean) => {
      unavailable = value;
    },
    close: async () => {
      await a.close();
      await b.close();
      await games.close();
    },
  };
}

test("replacement worker completes persisted absence grace after the old worker retires", async () => {
  const f = await fixture();
  try {
    f.online.delete("bob");
    await f.a.recoverPending();
    assert.deepEqual((await f.read()).registrationAbsences, [{ playerId: "bob", since: 100_000 }]);
    await f.a.close();
    f.advance(29_999);
    await f.b.recoverPending();
    assert.equal((await f.read()).participants.length, 2);
    f.advance(2);
    await f.b.recoverPending();
    assert.deepEqual(
      (await f.read()).participants.map((p) => [p.playerId, p.seed]),
      [["alice", 1]],
    );
    assert.deepEqual((await f.read()).registrationAbsences, []);
  } finally {
    await f.close();
  }
});

test("survivor discovers a completely missed disconnect and grants a fresh grace period", async () => {
  const f = await fixture();
  try {
    await f.a.close();
    f.online.delete("bob");
    f.advance(60_000);
    await f.b.recoverPending();
    assert.equal((await f.read()).participants.length, 2);
    assert.deepEqual((await f.read()).registrationAbsences, [{ playerId: "bob", since: 160_000 }]);
    f.advance(30_001);
    await f.b.recoverPending();
    assert.deepEqual(
      (await f.read()).participants.map((p) => p.playerId),
      ["alice"],
    );
  } finally {
    await f.close();
  }
});

test("reconnect on another replica clears absence; a later disconnect gets its own grace", async () => {
  const f = await fixture();
  try {
    f.online.delete("bob");
    await f.a.recoverPending();
    f.advance(14_000);
    f.online.add("bob");
    await f.b.recoverPending();
    assert.deepEqual((await f.read()).registrationAbsences, []);
    f.advance(50_000);
    f.online.delete("bob");
    await f.b.recoverPending();
    assert.equal((await f.read()).participants.length, 2);
    assert.deepEqual((await f.read()).registrationAbsences, [{ playerId: "bob", since: 164_000 }]);
  } finally {
    await f.close();
  }
});

test("failed shared presence reads never remove registration or establish absence", async () => {
  const f = await fixture();
  try {
    f.online.delete("bob");
    f.failPresence(true);
    await f.a.recoverPending();
    assert.equal((await f.read()).participants.length, 2);
    assert.deepEqual((await f.read()).registrationAbsences, []);
    f.advance(60_000);
    f.failPresence(false);
    await f.b.recoverPending();
    assert.equal((await f.read()).participants.length, 2);
    assert.deepEqual((await f.read()).registrationAbsences, [{ playerId: "bob", since: 160_000 }]);
  } finally {
    await f.close();
  }
});

test("a delayed disconnect callback rechecks shared presence before removing a reconnected player", async () => {
  const f = await fixture();
  try {
    f.callbacks[0]("bob");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await f.read()).participants.length, 2);
    f.online.delete("bob");
    f.callbacks[0]("bob");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      (await f.read()).participants.map((p) => p.playerId),
      ["alice"],
    );
  } finally {
    await f.close();
  }
});

test("a restarted worker grants a full grace before removing players whose leases vanished", async () => {
  const f = await fixture();
  try {
    f.online.delete("bob");
    await f.a.recoverPending();
    await f.a.close();
    f.advance(120_000);
    // Full restart: the new worker starts observing now, long after the old record.
    const restarted = new TournamentService(f.store, f.games, f.locks, () => f.now());
    try {
      await restarted.recoverPending();
      assert.equal((await f.read()).participants.length, 2);
      f.advance(29_999);
      await restarted.recoverPending();
      assert.equal((await f.read()).participants.length, 2);
      f.advance(2);
      await restarted.recoverPending();
      assert.deepEqual(
        (await f.read()).participants.map((p) => p.playerId),
        ["alice"],
      );
    } finally {
      await restarted.close();
    }
  } finally {
    await f.close();
  }
});
