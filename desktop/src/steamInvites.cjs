// @ts-check

const GAME_ID = /^[A-Z0-9]{6}$/;
const LOBBY_ID = /^[1-9][0-9]{0,19}$/;

/** Steam launch arguments are untrusted input; never treat them as URLs or code.
 * @param {string[]} argv
 */
function lobbyIdFromArgs(argv) {
  const index = argv.indexOf("+connect_lobby");
  const value = index < 0 ? null : argv[index + 1];
  return typeof value === "string" && LOBBY_ID.test(value) && BigInt(value) <= 2n ** 64n - 1n
    ? value
    : null;
}

/** Steam lobbies carry only a Tiao room code. The API still authorizes room access.
 * @param {{ getClient: () => any, notify: () => void }} options
 */
function createSteamInvites({ getClient, notify }) {
  /** @type {string | null} */
  let gameId = null;
  /** @type {any} */
  let lobby = null;
  /** @type {any} */
  let callback = null;
  /** @type {{ id: number; gameId: string | null } | null} */
  let pendingJoin = null;
  let opening = false;
  let joinVersion = 0;

  /** @param {any} value */
  function leave(value) {
    try {
      value?.leave();
    } catch (error) {
      console.warn("[steam] leaving invite lobby failed:", error);
    }
  }

  /** @param {unknown} value */
  function setGame(value) {
    const next = typeof value === "string" && GAME_ID.test(value) ? value : null;
    if (next === gameId) return;
    gameId = next;
    if (lobby) {
      try {
        lobby.setJoinable(false);
      } catch (error) {
        console.warn("[steam] closing invite lobby failed:", error);
      }
      leave(lobby);
      lobby = null;
    }
  }

  async function openInviteDialog() {
    const client = getClient();
    const target = gameId;
    if (!client || !target || opening) return false;
    opening = true;
    try {
      if (!lobby) {
        // Private: people join through an explicit Steam invitation.
        const created = await client.matchmaking.createLobby(0, 2);
        if (gameId !== target || getClient() !== client) {
          leave(created);
          return false;
        }
        try {
          if (!created.setData("tiao_game_id", target)) throw new Error("Lobby metadata refused");
        } catch (error) {
          leave(created);
          throw error;
        }
        lobby = created;
      }
      lobby.openInviteDialog();
      return true;
    } catch (error) {
      console.warn("[steam] opening invite dialog failed:", error);
      return false;
    } finally {
      opening = false;
    }
  }

  /** @param {unknown} id */
  async function joinLobby(id) {
    const client = getClient();
    if (!client || (typeof id !== "string" && typeof id !== "bigint")) return;
    const parsed = lobbyIdFromArgs(["+connect_lobby", String(id)]);
    if (!parsed) return;
    const version = ++joinVersion;
    let joined;
    try {
      joined = await client.matchmaking.joinLobby(BigInt(parsed));
      const target = joined.getData("tiao_game_id");
      if (version !== joinVersion || getClient() !== client) return;
      if (typeof target !== "string" || !GAME_ID.test(target))
        throw new Error("Invalid Tiao invite");
      pendingJoin = { id: version, gameId: target };
      notify();
    } catch (error) {
      console.warn("[steam] joining invite lobby failed:", error);
      if (version === joinVersion && getClient() === client) {
        pendingJoin = { id: version, gameId: null };
        notify();
      }
    } finally {
      // The lobby is an invite envelope, not the game's networking transport.
      // Leave promptly so another invited friend can try if this room is full.
      if (joined && joined.id !== lobby?.id) leave(joined);
    }
  }

  function start() {
    const client = getClient();
    if (!client || callback) return;
    try {
      callback = client.callback.register(
        client.callback.SteamCallback?.GameLobbyJoinRequested ?? 8,
        (/** @type {{ lobby_steam_id: bigint }} */ event) => void joinLobby(event.lobby_steam_id),
      );
    } catch (error) {
      console.warn("[steam] registering invite callback failed:", error);
    }
  }

  function stop() {
    setGame(null);
    ++joinVersion;
    try {
      callback?.disconnect();
    } catch (error) {
      console.warn("[steam] disconnecting invite callback failed:", error);
    }
    callback = null;
  }

  return {
    start,
    stop,
    setGame,
    openInviteDialog,
    joinLobby,
    getPendingJoin: () => pendingJoin,
    /** @param {unknown} id */
    acknowledgeJoin(id) {
      if (id === pendingJoin?.id) pendingJoin = null;
    },
  };
}

module.exports = { createSteamInvites, lobbyIdFromArgs };
