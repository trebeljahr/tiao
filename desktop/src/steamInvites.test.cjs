// @ts-check
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSteamInvites, lobbyIdFromArgs } = require("./steamInvites.cjs");

function fixture() {
  const calls = {
    created: 0,
    opened: 0,
    left: 0,
    closed: 0,
    notified: 0,
    registered: 0,
    disconnected: 0,
  };
  const data = new Map();
  const lobby = {
    id: 123n,
    setData: (/** @type {string} */ key, /** @type {string} */ value) => {
      data.set(key, value);
      return true;
    },
    getData: (/** @type {string} */ key) => data.get(key) ?? null,
    setJoinable: (/** @type {boolean} */ value) => {
      if (!value) ++calls.closed;
    },
    openInviteDialog: () => {
      ++calls.opened;
    },
    leave: () => {
      ++calls.left;
    },
  };
  /** @type {((event: { lobby_steam_id: bigint }) => void) | null} */
  let listener = null;
  const client = {
    matchmaking: {
      createLobby: async (/** @type {number} */ type, /** @type {number} */ limit) => {
        assert.equal(type, 0);
        assert.equal(limit, 2);
        ++calls.created;
        return lobby;
      },
      joinLobby: async (/** @type {bigint} */ id) => {
        assert.equal(id, 123n);
        return lobby;
      },
    },
    callback: {
      SteamCallback: { GameLobbyJoinRequested: 8 },
      register: (/** @type {number} */ code, /** @type {any} */ cb) => {
        assert.equal(code, 8);
        ++calls.registered;
        listener = cb;
        return {
          disconnect: () => {
            ++calls.disconnected;
          },
        };
      },
    },
  };
  const invites = createSteamInvites({
    getClient: () => client,
    notify: () => {
      ++calls.notified;
    },
  });
  return { calls, lobby, client, invites, data, getListener: () => listener };
}

test("Steam launch arguments accept only bounded decimal lobby IDs", () => {
  assert.equal(lobbyIdFromArgs(["Tiao", "+connect_lobby", "123"]), "123");
  for (const value of [
    "",
    "0",
    "-1",
    "1.5",
    "https://example.com",
    "123;open",
    "18446744073709551616",
  ]) {
    assert.equal(lobbyIdFromArgs(["+connect_lobby", value]), null);
  }
  assert.equal(lobbyIdFromArgs(["+connect_lobby"]), null);
  assert.equal(lobbyIdFromArgs(["--connect_lobby", "123"]), null);
});

test("standalone and inactive Steam clients safely decline invites", async () => {
  const invites = createSteamInvites({
    getClient: () => null,
    notify: () => assert.fail("Unexpected invite"),
  });
  invites.start();
  invites.setGame("ABC234");
  assert.equal(await invites.openInviteDialog(), false);
  await invites.joinLobby("123");
  assert.equal(invites.getPendingJoin(), null);
  invites.stop();
});

test("opens the native picker with room metadata and reuses its private lobby", async () => {
  const { invites, calls, data } = fixture();
  invites.setGame("ABC234");
  assert.equal(await invites.openInviteDialog(), true);
  assert.equal(data.get("tiao_game_id"), "ABC234");
  assert.equal(await invites.openInviteDialog(), true);
  assert.equal(calls.created, 1);
  assert.equal(calls.opened, 2);
  invites.setGame(null);
  assert.equal(calls.closed, 1);
  assert.equal(calls.left, 1);
  assert.equal(await invites.openInviteDialog(), false);
});

test("leaving or changing rooms invalidates in-flight lobby creation", async () => {
  const { invites, client, lobby, calls } = fixture();
  /** @type {(value: typeof lobby) => void} */
  let resolve = () => {};
  client.matchmaking.createLobby = () =>
    new Promise((r) => {
      resolve = r;
    });
  invites.setGame("ABC234");
  const opening = invites.openInviteDialog();
  invites.setGame("DEF567");
  resolve(lobby);
  assert.equal(await opening, false);
  assert.equal(calls.left, 1);
  assert.equal(calls.opened, 0);
});

test("failed metadata writes leave the lobby and allow retry", async () => {
  const { invites, lobby, calls } = fixture();
  lobby.setData = () => false;
  invites.setGame("ABC234");
  assert.equal(await invites.openInviteDialog(), false);
  assert.equal(calls.left, 1);
  assert.equal(calls.opened, 0);
  invites.setGame("https://example.com");
  assert.equal(await invites.openInviteDialog(), false);
});

test("accepted and cold-start invites wait for renderer acknowledgement", async () => {
  const { invites, calls, data } = fixture();
  data.set("tiao_game_id", "ABC234");
  await invites.joinLobby(lobbyIdFromArgs(["+connect_lobby", "123"]));
  assert.deepEqual(invites.getPendingJoin(), { id: 1, gameId: "ABC234" });
  assert.equal(calls.left, 1);
  assert.equal(calls.notified, 1);
  invites.acknowledgeJoin(0);
  assert.equal(invites.getPendingJoin()?.gameId, "ABC234");
  data.set("tiao_game_id", "DEF567");
  await invites.joinLobby("123");
  invites.acknowledgeJoin(1);
  assert.equal(invites.getPendingJoin()?.gameId, "DEF567");
  invites.acknowledgeJoin(2);
  assert.equal(invites.getPendingJoin(), null);
});

test("Steam callback is registered once, delivers the room, and disconnects on shutdown", async () => {
  const { invites, getListener, data, calls } = fixture();
  data.set("tiao_game_id", "ABC234");
  invites.start();
  invites.start();
  getListener()?.({ lobby_steam_id: 123n });
  await new Promise(setImmediate);
  assert.equal(calls.registered, 1);
  assert.equal(invites.getPendingJoin()?.gameId, "ABC234");
  invites.stop();
  assert.equal(calls.disconnected, 1);
});

test("invalid metadata and expired lobbies produce a recoverable failure", async () => {
  const { invites, client, calls, data } = fixture();
  data.set("tiao_game_id", "../../profile");
  await invites.joinLobby("123");
  assert.deepEqual(invites.getPendingJoin(), { id: 1, gameId: null });
  assert.equal(calls.left, 1);
  client.matchmaking.joinLobby = async () => {
    throw new Error("Lobby expired");
  };
  await invites.joinLobby("123");
  assert.deepEqual(invites.getPendingJoin(), { id: 2, gameId: null });
  assert.equal(calls.notified, 2);
  await invites.joinLobby("garbage");
  assert.equal(calls.notified, 2);
});

test("an older join finishing late cannot replace the latest accepted invite", async () => {
  const { invites, client, lobby, calls } = fixture();
  /** @type {(value: typeof lobby) => void} */
  let resolve = () => {};
  client.matchmaking.joinLobby = () =>
    new Promise((r) => {
      resolve = r;
    });
  const old = invites.joinLobby("123");
  client.matchmaking.joinLobby = async () => ({ ...lobby, getData: () => "DEF567" });
  await invites.joinLobby("123");
  resolve({ ...lobby, getData: () => "ABC234" });
  await old;
  assert.deepEqual(invites.getPendingJoin(), { id: 2, gameId: "DEF567" });
  assert.equal(calls.notified, 1);
  assert.equal(calls.left, 2);
});
