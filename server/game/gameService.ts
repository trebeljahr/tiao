import WebSocket from "ws";
import {
  ClientToServerMessage,
  FinishReason,
  FriendActiveGameSummary,
  LobbyClientMessage,
  MatchmakingState,
  MultiplayerGameSummary,
  MultiplayerGamesIndex,
  MultiplayerRematchState,
  MultiplayerRoomType,
  MultiplayerSnapshot,
  MultiplayerStatus,
  GameSettings,
  PlayerColor,
  PlayerIdentity,
  PlayerSlot,
  TimeControl,
  TurnRecord,
  confirmPendingJump,
  createInitialGameState,
  forfeitGame,
  getWinner,
  isGameOver,
  jumpPiece,
  placePiece,
  undoLastTurn,
  undoPendingJumpStep,
} from "../../shared/src";
import {
  GameRoomStore,
  MongoGameRoomStore,
  StoredMultiplayerRoom,
  StoredPlayerIdentity,
  StoredSeatAssignments,
  getPlayerColorForRoom,
} from "./gameStore";
import {
  getPlayerProfile,
  getPlayerProfiles,
  invalidatePlayerProfile,
  enrichIdentity,
  type CachedPlayerProfile,
} from "../cache/playerIdentityCache";

export class GameServiceError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

import { InMemoryLockProvider, LockProvider } from "./lockProvider";
import { InMemoryMatchmakingStore, MatchmakingStore } from "./matchmakingStore";
import { computeNewRatings, DEFAULT_RATING } from "./elo";
import GameAccount from "../models/GameAccount";
import {
  onGameCompleted as checkGameAchievements,
  onEloUpdated as checkEloAchievements,
  onPieceCaptured as checkPieceCapturedAchievement,
  onSpectateStarted as checkSpectateAchievement,
  setAchievementNotifier,
  setAchievementChangeNotifier,
} from "./achievementService";
import mongoose, { isValidObjectId } from "mongoose";
import type { RatingStatus } from "../models/GameRoom";

type RoomConnections = Map<WebSocket, string>;

/** Sentinel display name set during account deletion (GDPR anonymization). */
export const DELETED_PLAYER_NAME = "Deleted Player";

const GUEST_ABANDON_TIMEOUT_MS = 5 * 60 * 1000;
const FIRST_MOVE_TIMEOUT_MS = 30 * 1000;
const TOURNAMENT_FIRST_MOVE_TIMEOUT_MS = 60 * 1000;

export interface TournamentGameCallback {
  onGameCompleted(roomId: string): Promise<void>;
  broadcastLiveScore(
    tournamentId: string,
    matchId: string,
    score: { white: number; black: number },
  ): Promise<void>;
}

export class GameService {
  private readonly connections = new Map<string, RoomConnections>();
  private readonly lobbyConnections = new Map<string, Set<WebSocket>>();
  /**
   * The single socket that owns each player's current matchmaking session.
   * Tied to socket identity (not playerId) so that closing the matchmaking tab
   * removes the queue entry even if the player has other lobby tabs open.
   */
  private readonly matchmakingSocketByPlayer = new Map<string, WebSocket>();
  private readonly socketRooms = new Map<WebSocket, string>();
  /** In-memory spectator identities: roomId -> (playerId -> PlayerIdentity) */
  private readonly spectatorIdentities = new Map<string, Map<string, PlayerIdentity>>();
  private readonly matchmaking: MatchmakingStore;
  private readonly lockProvider: LockProvider;
  private readonly guestAbandonTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly clockTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly firstMoveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private tournamentCallback: TournamentGameCallback | null = null;
  private readonly lobbyDisconnectCallbacks: Array<(playerId: string) => void> = [];
  private matchmakingSweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: GameRoomStore = new MongoGameRoomStore(),
    private readonly seatRandom: () => number = Math.random,
    private readonly abandonTimeoutMs: number = GUEST_ABANDON_TIMEOUT_MS,
    matchmaking?: MatchmakingStore,
    lockProvider?: LockProvider,
  ) {
    this.matchmaking = matchmaking ?? new InMemoryMatchmakingStore();
    this.lockProvider = lockProvider ?? new InMemoryLockProvider();
  }

  setTournamentService(svc: TournamentGameCallback): void {
    this.tournamentCallback = svc;
  }

  onLobbyDisconnect(callback: (playerId: string) => void): void {
    this.lobbyDisconnectCallbacks.push(callback);
  }

  async createTournamentGame(
    player1: PlayerIdentity,
    player2: PlayerIdentity,
    timeControl: TimeControl,
    tournamentId: string,
    matchId: string,
  ): Promise<StoredMultiplayerRoom> {
    const tc = timeControl ?? null;
    const clockMs = tc ? { white: tc.initialMs, black: tc.initialMs } : null;

    // Tournament games defer the first-move deadline until both players connect
    const firstMoveDeadline = null;

    const toSlim = (p: PlayerIdentity): StoredPlayerIdentity => ({
      playerId: p.playerId,
      displayName: p.displayName,
      kind: p.kind,
    });

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const room = this.deriveRoomStatus({
        id: this.generateRoomId(),
        roomType: "tournament",
        status: "waiting",
        state: createInitialGameState(),
        rematch: null,
        takeback: null,
        seats: this.assignSeats(toSlim(player1), toSlim(player2)),
        timeControl: tc,
        clockMs,
        lastMoveAt: null,
        firstMoveDeadline,
        ratingBefore: null,
        ratingAfter: null,
        ratingStatus: null,
        tournamentId,
        tournamentMatchId: matchId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      try {
        const createdRoom = await this.store.createRoom({
          id: room.id,
          roomType: room.roomType,
          status: room.status,
          state: room.state,
          rematch: room.rematch,
          takeback: room.takeback,
          seats: room.seats,
          timeControl: room.timeControl,
          clockMs: room.clockMs,
          lastMoveAt: room.lastMoveAt,
          firstMoveDeadline: room.firstMoveDeadline,
          tournamentId: room.tournamentId,
          tournamentMatchId: room.tournamentMatchId,
        });

        // Timer is NOT scheduled here — it starts when both players connect
        return createdRoom;
      } catch (error) {
        if (this.isDuplicateRoomError(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new GameServiceError(
      500,
      "ROOM_CREATE_FAILED",
      "Unable to create a tournament game room right now.",
    );
  }

  isPlayerConnectedToLobby(playerId: string): boolean {
    const sockets = this.lobbyConnections.get(playerId);
    return !!sockets && sockets.size > 0;
  }

  async connectLobby(player: PlayerIdentity, socket: WebSocket): Promise<void> {
    let userSockets = this.lobbyConnections.get(player.playerId);
    if (!userSockets) {
      userSockets = new Set();
      this.lobbyConnections.set(player.playerId, userSockets);
    }
    userSockets.add(socket);

    socket.on("message", (raw) => {
      void this.handleLobbyMessage(player, socket, raw);
    });

    socket.on("close", () => {
      userSockets?.delete(socket);

      // If this socket owned the player's matchmaking session, clear the queue
      // entry regardless of whether other lobby tabs remain open. This is the
      // core fix for "ghost" matches: closing the matchmaking tab (or any
      // disconnect event on that specific socket) removes the player from the
      // queue before the sweep can pair them with a real opponent.
      if (this.matchmakingSocketByPlayer.get(player.playerId) === socket) {
        this.matchmakingSocketByPlayer.delete(player.playerId);
        void this.leaveMatchmaking(player).catch((err) => {
          console.error("[lobby] failed to clear matchmaking on disconnect", err);
        });
      }

      if (userSockets?.size === 0) {
        this.lobbyConnections.delete(player.playerId);
        void this.revokeRematchesOnDisconnect(player.playerId);
        for (const cb of this.lobbyDisconnectCallbacks) {
          try {
            cb(player.playerId);
          } catch {
            /* best-effort */
          }
        }
      }
    });

    // Push pending incoming rematch requests so the player sees a toast on login
    void this.pushPendingRematches(player.playerId, socket);
  }

  private async handleLobbyMessage(
    player: PlayerIdentity,
    socket: WebSocket,
    raw: WebSocket.RawData,
  ): Promise<void> {
    let parsed: LobbyClientMessage;
    try {
      parsed = JSON.parse(raw.toString()) as LobbyClientMessage;
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") {
      return;
    }

    if (parsed.type === "matchmaking:enter") {
      try {
        const state = await this.enterMatchmakingViaSocket(player, parsed.timeControl, socket);
        this.sendLobbyMessage(socket, { type: "matchmaking:state", state });
      } catch (error) {
        const code = error instanceof GameServiceError ? error.code : "MATCHMAKING_ERROR";
        const message =
          error instanceof Error ? error.message : "Unable to enter matchmaking right now.";
        this.sendLobbyMessage(socket, { type: "matchmaking:error", code, message });
      }
      return;
    }

    if (parsed.type === "matchmaking:leave") {
      try {
        await this.leaveMatchmakingViaSocket(player, socket);
      } catch (error) {
        console.error("[lobby] matchmaking:leave failed", error);
      }
      this.sendLobbyMessage(socket, { type: "matchmaking:state", state: { status: "idle" } });
    }
  }

  private sendLobbyMessage(socket: WebSocket, payload: Record<string, unknown>): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }

  /**
   * On lobby connect, send game-update messages for any finished games where the
   * opponent has requested a rematch. This ensures the player sees a notification
   * toast even if the rematch was requested while they were offline.
   */
  private async pushPendingRematches(playerId: string, socket: WebSocket): Promise<void> {
    try {
      const rooms = await this.store.listRoomsForPlayer(playerId);
      for (const room of rooms) {
        if (room.status !== "finished" || !room.rematch?.requestedBy.length) continue;
        const derived = this.deriveRoomStatus(room);
        const playerColor = getPlayerColorForRoom(derived, playerId);
        // Only push if the OTHER player requested (incoming rematch)
        if (!playerColor || derived.rematch?.requestedBy.includes(playerColor)) continue;

        const summary = await this.toSummary(derived, playerId);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "game-update", summary }));
        }
      }
    } catch {
      /* best-effort — don't let push errors break the connect flow */
    }
  }

  broadcastLobby(playerId: string, payload: Record<string, unknown>): void {
    const userSockets = this.lobbyConnections.get(playerId);
    if (!userSockets) return;

    const message = JSON.stringify(payload);
    for (const socket of userSockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    }
  }

  /**
   * Broadcast a payload to every currently-connected lobby socket (every user,
   * not just one). Use for updates that any viewer might be rendering right now
   * — e.g. a player equipping a new badge should update everyone who currently
   * has that player on screen (lobby active-games list, friends list, profile).
   */
  broadcastLobbyToAll(payload: Record<string, unknown>): void {
    const message = JSON.stringify(payload);
    for (const userSockets of this.lobbyConnections.values()) {
      for (const socket of userSockets) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(message);
        }
      }
    }
  }

  async unlinkTournamentGames(tournamentId: string): Promise<number> {
    return this.store.unlinkTournamentGames(tournamentId);
  }

  async createGame(
    creator: PlayerIdentity,
    options: {
      roomType?: MultiplayerRoomType;
      gameSettings?: Partial<GameSettings>;
      timeControl?: TimeControl;
      creatorColor?: PlayerColor;
    } = {},
  ): Promise<MultiplayerSnapshot> {
    return this.withLocks([this.playerLockKey(creator.playerId)], async () => {
      const slimCreator: StoredPlayerIdentity = {
        playerId: creator.playerId,
        displayName: creator.displayName,
        kind: creator.kind,
      };
      const room = await this.createRoomRecord({
        roomType: options.roomType ?? "direct",
        assignSeats: false,
        gameSettings: options.gameSettings,
        timeControl: options.timeControl,
      });

      // Pre-seat the creator so they are recognized as a participant immediately
      const creatorSeat: PlayerColor =
        options.creatorColor ?? (this.seatRandom() < 0.5 ? "white" : "black");
      const seatedRoom = await this.saveRoom({
        ...room,
        seats: {
          white: creatorSeat === "white" ? slimCreator : null,
          black: creatorSeat === "black" ? slimCreator : null,
        },
      });

      return this.toSnapshot(seatedRoom);
    });
  }

  async cancelWaitingRoom(gameId: string, player: PlayerIdentity): Promise<void> {
    return this.withLocks([this.roomLockKey(gameId)], async () => {
      const room = await this.getRoom(gameId);

      if (room.status !== "waiting") {
        throw new GameServiceError(409, "GAME_NOT_WAITING", "Only waiting games can be cancelled.");
      }

      if (!this.isPlayerInRoom(room, player.playerId)) {
        throw new GameServiceError(403, "NOT_IN_GAME", "You are not a player in this game.");
      }

      const seatCount = (room.seats.white ? 1 : 0) + (room.seats.black ? 1 : 0);
      if (seatCount <= 1) {
        // Only player in the game — delete it entirely so it doesn't appear in history
        await this.store.deleteRoom(gameId);
      } else {
        // Another player exists — mark as finished so it doesn't block them
        await this.saveRoom({
          ...room,
          status: "finished",
          state: { ...room.state, history: [...room.state.history, { type: "draw" }] },
        });
      }
    });
  }

  async joinGame(gameId: string, player: PlayerIdentity): Promise<MultiplayerSnapshot> {
    return this.withLocks(
      [this.roomLockKey(gameId), this.playerLockKey(player.playerId)],
      async () => {
        const room = await this.getRoom(gameId);

        const savedRoom = await this.joinRoom(room, player);
        await this.broadcastSnapshot(savedRoom);
        return this.toSnapshot(savedRoom);
      },
    );
  }

  async accessGame(gameId: string, player: PlayerIdentity): Promise<MultiplayerSnapshot> {
    return this.withLocks(
      [this.roomLockKey(gameId), this.playerLockKey(player.playerId)],
      async () => {
        const room = await this.getRoom(gameId);

        if (this.isPlayerInRoom(room, player.playerId)) {
          return this.toSnapshot(room);
        }

        if (room.seats.white && room.seats.black) {
          return this.toSnapshot(room);
        }

        const savedRoom = await this.joinRoom(room, player);
        await this.broadcastSnapshot(savedRoom);
        return this.toSnapshot(savedRoom);
      },
    );
  }

  async getSnapshot(gameId: string): Promise<MultiplayerSnapshot> {
    return this.toSnapshot(await this.getRoom(gameId));
  }

  /** Re-read room from DB and broadcast to all connected clients. */
  async rebroadcastSnapshot(gameId: string): Promise<void> {
    const room = await this.store.getRoom(gameId);
    if (!room) return;
    await this.broadcastSnapshot(this.deriveRoomStatus(room));
  }

  /**
   * Migrate all games where `guestId` is seated to the new `newIdentity`.
   * Called when an anonymous user signs up for a new account or signs in to
   * an existing one. For each affected room:
   *
   *  - If the *other* seat is already held by `newIdentity.playerId`, the
   *    game would end up with the same player on both sides — delete the
   *    room entirely, notify any open game sockets with `game-aborted`
   *    (code `ANON_CONFLICT`), and notify the new account's lobby sockets
   *    with `game-removed` so games/history lists refetch and drop the
   *    vanished game.
   *  - Otherwise, rewrite the guest seat to the new identity, broadcast a
   *    fresh snapshot to the room, and let the usual lobby `game-update`
   *    side-effect push an updated summary.
   *
   * Returns the counts of migrated vs. deleted rooms (useful for logging
   * and tests).
   */
  async migrateGuestToAccount(
    guestId: string,
    newIdentity: StoredPlayerIdentity,
  ): Promise<{ migrated: number; deleted: number; deletedRoomIds: string[] }> {
    if (guestId === newIdentity.playerId) {
      return { migrated: 0, deleted: 0, deletedRoomIds: [] };
    }

    const rooms = await this.store.listRoomsForPlayer(guestId);
    let migrated = 0;
    let deleted = 0;
    const deletedRoomIds: string[] = [];

    for (const room of rooms) {
      const action = await this.withLock(this.roomLockKey(room.id), async () => {
        const fresh = await this.store.getRoom(room.id);
        if (!fresh) return "skipped" as const;

        // Determine which colour the guest occupies and who sits in the other seat
        const guestColor: PlayerColor | null =
          fresh.seats.white?.playerId === guestId
            ? "white"
            : fresh.seats.black?.playerId === guestId
              ? "black"
              : null;
        if (!guestColor) return "skipped" as const;

        const otherColor: PlayerColor = guestColor === "white" ? "black" : "white";
        const otherSeat = fresh.seats[otherColor];

        if (otherSeat && otherSeat.playerId === newIdentity.playerId) {
          // Conflict — same player would end up on both sides. Delete the room.
          await this.store.deleteRoom(fresh.id);
          this.clearClockTimer(fresh.id);
          this.clearFirstMoveTimer(fresh.id);
          this.clearAbandonTimer(fresh.id, guestId);
          this.clearAbandonTimer(fresh.id, newIdentity.playerId);

          // Notify any active game sockets so open tabs redirect to the lobby.
          const connections = this.connections.get(fresh.id);
          if (connections) {
            const message = JSON.stringify({
              type: "game-aborted",
              code: "ANON_CONFLICT",
              reason: "Anonymous user left the game.",
              requeuedForMatchmaking: false,
              timeControl: fresh.timeControl,
            });
            for (const socket of connections.keys()) {
              if (socket.readyState === WebSocket.OPEN) {
                try {
                  socket.send(message);
                } catch {
                  /* best-effort */
                }
              }
            }
            this.connections.delete(fresh.id);
          }

          // Also flush any spectator-identity tracking for the vanished room.
          this.spectatorIdentities.delete(fresh.id);

          // Tell the account's lobby sockets (other tabs / devices) to drop
          // the game from their active + history lists.
          this.broadcastLobby(newIdentity.playerId, {
            type: "game-removed",
            gameId: fresh.id,
          });

          return "deleted" as const;
        }

        // No conflict — rewrite the guest seat to the new identity.
        const nextSeats: StoredSeatAssignments = {
          white:
            guestColor === "white"
              ? { ...newIdentity }
              : fresh.seats.white
                ? { ...fresh.seats.white }
                : null,
          black:
            guestColor === "black"
              ? { ...newIdentity }
              : fresh.seats.black
                ? { ...fresh.seats.black }
                : null,
        };

        const savedRoom = await this.saveRoom({
          ...fresh,
          seats: nextSeats,
        });

        void this.broadcastSnapshot(savedRoom);
        return "migrated" as const;
      });

      if (action === "deleted") {
        deleted += 1;
        deletedRoomIds.push(room.id);
      } else if (action === "migrated") {
        migrated += 1;
      }
    }

    return { migrated, deleted, deletedRoomIds };
  }

  /**
   * Forfeit a game on behalf of a player (e.g. during account deletion).
   * Broadcasts the updated snapshot to all connected clients.
   */
  async forfeitForPlayer(gameId: string, playerId: string): Promise<void> {
    await this.withLock(this.roomLockKey(gameId), async () => {
      const room = await this.store.getRoom(gameId);
      if (!room) return;

      const derived = this.deriveRoomStatus(room);
      if (derived.status !== "active") return;

      const playerColor = getPlayerColorForRoom(derived, playerId);
      if (!playerColor) return;

      const result = forfeitGame(derived.state, playerColor, "forfeit");
      if (!result.ok) return;
      derived.state = result.value;
      const savedRoom = await this.saveRoom(derived);
      void this.broadcastSnapshot(savedRoom);
    });
  }

  /** Enrich game summaries with fresh player data from the identity cache. */
  private async enrichSummaries(summaries: MultiplayerGameSummary[]): Promise<void> {
    const playerIds = new Set<string>();
    for (const s of summaries) {
      for (const color of ["white", "black"] as const) {
        const slot = s.seats[color];
        if (slot?.player.playerId) playerIds.add(slot.player.playerId);
      }
    }
    if (playerIds.size === 0) return;

    const profiles = await getPlayerProfiles([...playerIds]);

    for (const s of summaries) {
      for (const color of ["white", "black"] as const) {
        const slot = s.seats[color];
        if (!slot) continue;
        const profile = profiles.get(slot.player.playerId);
        if (!profile) continue;
        slot.player = {
          ...slot.player,
          displayName: profile.displayName,
          profilePicture: profile.profilePicture,
          activeBadges: profile.activeBadges,
          badges: profile.badges,
          rating: profile.rating,
        };
      }
      // Also enrich the players list (derived from seats)
      for (const slot of s.players) {
        const profile = profiles.get(slot.player.playerId);
        if (!profile) continue;
        slot.player = {
          ...slot.player,
          displayName: profile.displayName,
          profilePicture: profile.profilePicture,
          activeBadges: profile.activeBadges,
          badges: profile.badges,
          rating: profile.rating,
        };
      }
    }
  }

  async listGames(player: PlayerIdentity): Promise<MultiplayerGamesIndex> {
    const rooms = await this.store.listRoomsForPlayer(player.playerId);
    const summaries = await Promise.all(
      rooms.map((room) => this.toSummary(this.deriveRoomStatus(room), player.playerId)),
    );

    return {
      active: summaries.filter((game) => game.status !== "finished"),
      finished: summaries.filter((game) => game.status === "finished"),
    };
  }

  async listFinishedGames(
    playerId: string,
    limit = 20,
    beforeDate?: Date,
  ): Promise<{ games: MultiplayerGameSummary[]; hasMore: boolean }> {
    const rooms = await this.store.listFinishedRoomsForPlayer(playerId, limit + 1, beforeDate);
    const hasMore = rooms.length > limit;
    const trimmed = hasMore ? rooms.slice(0, limit) : rooms;
    const games = await Promise.all(
      trimmed.map((room) => this.toSummary(this.deriveRoomStatus(room), playerId)),
    );
    return { games, hasMore };
  }

  async listActiveGamesForPlayer(playerId: string): Promise<FriendActiveGameSummary[]> {
    const rooms = await this.store.listActiveRoomsForPlayer(playerId);

    // Batch-resolve all player profiles for efficiency
    const allPlayerIds = new Set<string>();
    for (const room of rooms) {
      if (room.seats.white) allPlayerIds.add(room.seats.white.playerId);
      if (room.seats.black) allPlayerIds.add(room.seats.black.playerId);
    }
    const profiles = await getPlayerProfiles([...allPlayerIds]);

    return rooms.map((room) => {
      const derived = this.deriveRoomStatus(room);

      const enrichSeat = (color: PlayerColor): PlayerSlot | null => {
        const seat = derived.seats[color];
        if (!seat) return null;
        return this.toPlayerSlot(derived.id, this.resolveIdentity(seat, profiles));
      };

      return {
        gameId: derived.id,
        roomType: derived.roomType,
        status: derived.status,
        createdAt: derived.createdAt.toISOString(),
        updatedAt: derived.updatedAt.toISOString(),
        currentTurn: derived.state.currentTurn,
        score: {
          black: derived.state.score.black,
          white: derived.state.score.white,
        },
        boardSize: derived.state.boardSize,
        scoreToWin: derived.state.scoreToWin,
        timeControl: derived.timeControl,
        clockMs: derived.clockMs ?? null,
        seats: {
          white: enrichSeat("white"),
          black: enrichSeat("black"),
        },
        ratingBefore: derived.ratingBefore ?? null,
      };
    });
  }

  /** Invalidate a player's cached identity and re-broadcast snapshots for their active rooms. */
  async refreshPlayerInActiveRooms(player: PlayerIdentity): Promise<void> {
    invalidatePlayerProfile(player.playerId);
    const rooms = await this.store.listActiveRoomsForPlayer(player.playerId);
    for (const room of rooms) {
      void this.broadcastSnapshot(room);
    }
    // Broadcast the identity update to EVERY connected lobby socket so any
    // viewer currently rendering this player — active-games list, friends
    // list, tournament UI, profile — patches their cached copy in place.
    // (Previously this sent only to the player's own socket, which meant
    // nobody else ever saw the update until they hard-refreshed.)
    this.broadcastLobbyToAll({
      type: "player-identity-update",
      playerId: player.playerId,
      displayName: player.displayName,
      profilePicture: player.profilePicture,
      rating: player.rating,
      activeBadges: player.activeBadges,
    });
  }

  async connect(gameId: string, player: PlayerIdentity, socket: WebSocket): Promise<void> {
    const room = await this.getRoom(gameId);

    this.clearAbandonTimer(room.id, player.playerId);

    const connections = this.getConnections(room.id);
    connections.set(socket, player.playerId);
    this.socketRooms.set(socket, room.id);

    // Track spectator identity (non-players connecting to a room)
    if (!this.isPlayerInRoom(room, player.playerId)) {
      let roomSpectators = this.spectatorIdentities.get(room.id);
      if (!roomSpectators) {
        roomSpectators = new Map();
        this.spectatorIdentities.set(room.id, roomSpectators);
      }
      roomSpectators.set(player.playerId, player);

      // Achievement: spectate a game
      if (player.kind === "account") {
        void checkSpectateAchievement(player.playerId).catch((err) => {
          console.error("[game] Spectate achievement check failed:", err);
        });
      }
    }

    // For timed tournament games: start the first-move timer when both players connect
    if (
      room.roomType === "tournament" &&
      room.timeControl &&
      room.status === "active" &&
      !room.lastMoveAt &&
      !room.firstMoveDeadline &&
      this.areBothPlayersConnected(room)
    ) {
      await this.withLock(this.roomLockKey(room.id), async () => {
        // Re-fetch inside lock to avoid race
        const freshRoom = await this.getRoom(room.id);
        if (freshRoom.firstMoveDeadline || freshRoom.lastMoveAt) return;

        const deadline = new Date(Date.now() + TOURNAMENT_FIRST_MOVE_TIMEOUT_MS);
        const savedRoom = await this.saveRoom({
          ...freshRoom,
          firstMoveDeadline: deadline,
        });
        this.scheduleFirstMoveTimer(savedRoom);
        void this.broadcastSnapshot(savedRoom);
      });
      return;
    }

    // Ensure the clock timer is running for active timed games (e.g. after
    // server restart or if no timer was scheduled for this room yet).
    if (
      room.status === "active" &&
      room.clockMs &&
      room.lastMoveAt &&
      !this.clockTimers.has(room.id)
    ) {
      this.scheduleClockTimer(room);
    }

    await this.broadcastSnapshot(room);
  }

  async disconnect(socket: WebSocket): Promise<void> {
    const roomId = this.socketRooms.get(socket);
    this.socketRooms.delete(socket);

    if (!roomId) {
      return;
    }

    const connections = this.connections.get(roomId);
    if (!connections) {
      return;
    }

    const disconnectedPlayerId = connections.get(socket);
    connections.delete(socket);

    if (connections.size === 0) {
      this.connections.delete(roomId);
    }

    // Remove spectator identity when all their sockets disconnect
    if (disconnectedPlayerId && !this.isPlayerOnline(roomId, disconnectedPlayerId)) {
      const roomSpectators = this.spectatorIdentities.get(roomId);
      if (roomSpectators) {
        roomSpectators.delete(disconnectedPlayerId);
        if (roomSpectators.size === 0) {
          this.spectatorIdentities.delete(roomId);
        }
      }
    }

    const room = await this.store.getRoom(roomId);
    if (!room) {
      return;
    }

    let derivedRoom = this.deriveRoomStatus(room);

    // Auto-revoke any pending rematch when *either* seated player disconnects
    // from a finished game. The original implementation only cleared the
    // rematch when the *sender* left, which left a stale request behind if the
    // *receiver* closed the browser instead — when the receiver came back
    // online, pushPendingRematches would resurface the still-pending rematch
    // as a new toast (and the sender's "waiting for opponent" view never
    // cleared either). Either party leaving invalidates the rematch.
    // Uses the room lock to prevent races with concurrent rematch acceptance.
    if (
      disconnectedPlayerId &&
      derivedRoom.status === "finished" &&
      derivedRoom.rematch?.requestedBy.length &&
      !this.isPlayerOnline(roomId, disconnectedPlayerId)
    ) {
      derivedRoom = await this.withLock(this.roomLockKey(roomId), async () => {
        const freshRoom = this.deriveRoomStatus(await this.getRoom(roomId));
        if (!freshRoom.rematch?.requestedBy.length) return freshRoom;
        const playerColor = getPlayerColorForRoom(freshRoom, disconnectedPlayerId);
        if (!playerColor) return freshRoom;
        return this.saveRoom({ ...freshRoom, rematch: null });
      });
    }

    void this.broadcastSnapshot(derivedRoom);

    // Start abandon timer for guest players who fully disconnect from an active game
    if (
      disconnectedPlayerId &&
      derivedRoom.status === "active" &&
      !this.isPlayerOnline(roomId, disconnectedPlayerId)
    ) {
      const disconnectedSeat =
        derivedRoom.seats.white?.playerId === disconnectedPlayerId
          ? derivedRoom.seats.white
          : derivedRoom.seats.black?.playerId === disconnectedPlayerId
            ? derivedRoom.seats.black
            : null;
      if (disconnectedSeat?.kind === "guest") {
        this.startAbandonTimer(roomId, disconnectedPlayerId);
      }
    }
  }

  /**
   * Cancel a pending rematch request via REST (for use outside the game page).
   */
  async cancelRematchViaRest(gameId: string, player: PlayerIdentity): Promise<void> {
    await this.withLock(this.roomLockKey(gameId), async () => {
      const room = await this.getRoom(gameId);
      const playerColor = getPlayerColorForRoom(room, player.playerId);
      if (!playerColor) {
        throw new GameServiceError(403, "NOT_IN_GAME", "You are not seated in this game.");
      }
      const savedRoom = await this.cancelRematch(room, playerColor);
      void this.broadcastSnapshot(savedRoom);
    });
  }

  /**
   * Accept a rematch via REST. Used by the global rematch toast so a player can
   * accept directly without first navigating to the old game page. Strictly
   * requires the *opponent* to currently have a pending rematch request — if
   * the opponent disconnected (and the disconnect handler cleared the rematch)
   * or declined moments before, this throws REMATCH_EXPIRED so the toast can
   * show a friendly error instead of silently turning the accept into a fresh
   * rematch request from this player. Returns `{ newGameId }` with the new
   * room id created once both players have agreed.
   */
  async requestRematchViaRest(
    gameId: string,
    player: PlayerIdentity,
  ): Promise<{ newGameId: string }> {
    return this.withLock(this.roomLockKey(gameId), async () => {
      const room = await this.getRoom(gameId);
      const playerColor = getPlayerColorForRoom(room, player.playerId);
      if (!playerColor) {
        throw new GameServiceError(403, "NOT_IN_GAME", "You are not seated in this game.");
      }

      // The toast is only shown to the opponent of an existing rematch request.
      // By the time the user clicks Accept, the requester may have left and the
      // disconnect handler cleared the rematch state. Surface a clear error.
      const opponentColor = playerColor === "white" ? "black" : "white";
      const opponentRequested = room.rematch?.requestedBy.includes(opponentColor) ?? false;
      if (!opponentRequested) {
        throw new GameServiceError(
          410,
          "REMATCH_EXPIRED",
          "Your opponent cancelled the rematch request — can't join rematch.",
        );
      }

      const result = await this.requestRematch(room, playerColor);
      // requestRematch returns the NEW room when both have agreed. Since we
      // just verified the opponent had requested, this branch should always
      // be taken — but defensively handle the unexpected case.
      if (result.id === gameId) {
        void this.broadcastSnapshot(result);
        throw new GameServiceError(
          500,
          "REMATCH_FAILED",
          "Rematch could not be created. Please try again.",
        );
      }
      return { newGameId: result.id };
    });
  }

  /**
   * Decline a rematch request via REST (for use from the global rematch toast).
   */
  async declineRematchViaRest(gameId: string, player: PlayerIdentity): Promise<void> {
    await this.withLock(this.roomLockKey(gameId), async () => {
      const room = await this.getRoom(gameId);
      const playerColor = getPlayerColorForRoom(room, player.playerId);
      if (!playerColor) {
        throw new GameServiceError(403, "NOT_IN_GAME", "You are not seated in this game.");
      }
      const savedRoom = await this.declineRematch(room, playerColor);
      void this.broadcastSnapshot(savedRoom);
    });
  }

  async applyAction(
    gameId: string,
    player: PlayerIdentity,
    message: ClientToServerMessage,
  ): Promise<MultiplayerSnapshot> {
    return this.withLock(this.roomLockKey(gameId), async () => {
      const room = await this.getRoom(gameId);
      const playerColor = getPlayerColorForRoom(room, player.playerId);

      if (!playerColor) {
        throw new GameServiceError(403, "NOT_IN_GAME", "You are not seated in this game.");
      }

      let result;
      switch (message.type) {
        case "request-rematch": {
          const savedRoom = await this.requestRematch(room, playerColor);
          void this.broadcastSnapshot(savedRoom);
          return this.toSnapshot(savedRoom);
        }
        case "decline-rematch": {
          const savedRoom = await this.declineRematch(room, playerColor);
          void this.broadcastSnapshot(savedRoom);
          return this.toSnapshot(savedRoom);
        }
        case "cancel-rematch": {
          const savedRoom = await this.cancelRematch(room, playerColor);
          void this.broadcastSnapshot(savedRoom);
          return this.toSnapshot(savedRoom);
        }
        case "request-takeback": {
          const savedRoom = await this.requestTakeback(room, playerColor);
          void this.broadcastSnapshot(savedRoom);
          return this.toSnapshot(savedRoom);
        }
        case "accept-takeback": {
          const savedRoom = await this.acceptTakeback(room, playerColor);
          void this.broadcastSnapshot(savedRoom);
          return this.toSnapshot(savedRoom);
        }
        case "decline-takeback": {
          const savedRoom = await this.declineTakeback(room, playerColor);
          void this.broadcastSnapshot(savedRoom);
          return this.toSnapshot(savedRoom);
        }
        case "forfeit": {
          if (room.status !== "active") {
            throw new GameServiceError(
              409,
              "GAME_NOT_ACTIVE",
              "You can only forfeit an active game.",
            );
          }
          result = forfeitGame(room.state, playerColor);
          break;
        }
        case "place-piece":
          this.ensureActionableRoom(room, playerColor);
          this.validatePosition(message.position);
          result = placePiece(room.state, message.position);
          break;
        case "jump-piece":
          this.ensureActionableRoom(room, playerColor);
          this.validatePosition(message.from);
          this.validatePosition(message.to);
          result = jumpPiece(room.state, message.from, message.to);
          break;
        case "confirm-jump":
          this.ensureActionableRoom(room, playerColor);
          result = confirmPendingJump(room.state);
          break;
        case "undo-pending-jump-step":
          this.ensureActionableRoom(room, playerColor);
          result = undoPendingJumpStep(room.state);
          break;
        default:
          throw new GameServiceError(400, "UNKNOWN_ACTION", "That message type is not supported.");
      }

      if (!result.ok) {
        throw new GameServiceError(409, result.code, result.reason);
      }

      // Stamp timestamps on newly added move records (for clock restoration on takeback)
      const now = Date.now();
      for (let i = room.state.history.length; i < result.value.history.length; i++) {
        const rec = result.value.history[i];
        if (rec.type === "put" || rec.type === "jump") {
          rec.timestamp = now;
        }
      }

      // Clock logic: deduct elapsed time and add increment on turn change
      const clockMs = room.clockMs ? { ...room.clockMs } : null;
      let lastMoveAt = room.lastMoveAt;

      if (clockMs && room.timeControl && room.status === "active" && lastMoveAt) {
        const now = new Date();
        const elapsed = now.getTime() - lastMoveAt.getTime();
        const movingColor = room.state.currentTurn;

        clockMs[movingColor] = Math.max(0, clockMs[movingColor] - elapsed);

        // Check for time expiry
        if (clockMs[movingColor] <= 0) {
          const flagResult = forfeitGame(room.state, movingColor, "timeout");
          if (flagResult.ok) {
            const flaggedRoom = await this.saveRoom({
              ...room,
              state: flagResult.value,
              clockMs,
              lastMoveAt: now,
            });
            this.clearClockTimer(room.id);
            void this.broadcastSnapshot(flaggedRoom);
            return this.toSnapshot(flaggedRoom);
          }
        }

        // Add increment when turn changes (place-piece or confirm-jump)
        const turnChanged = result.value.currentTurn !== movingColor;
        if (turnChanged && room.timeControl.incrementMs > 0) {
          clockMs[movingColor] += room.timeControl.incrementMs;
        }

        lastMoveAt = now;
      }

      // Start the clock on first move if it hasn't been set
      if (clockMs && room.timeControl && !lastMoveAt && room.status === "active") {
        lastMoveAt = new Date();
        // Clear first-move timer since a move was made in time
        this.clearFirstMoveTimer(room.id);
      }

      // Clear any pending takeback when a game action is made
      // Clear firstMoveDeadline once the first move is made (lastMoveAt is now set)
      const savedRoom = await this.saveRoom({
        ...room,
        state: result.value,
        takeback: null,
        clockMs,
        lastMoveAt,
        firstMoveDeadline: lastMoveAt ? null : room.firstMoveDeadline,
      });

      // Schedule flag timer for the next player
      this.scheduleClockTimer(savedRoom);

      await this.broadcastSnapshot(savedRoom);

      // First Blood achievement: fire as soon as a player captures a piece,
      // not at game end. Score increments only on confirm-jump.
      // Skip when Mongoose isn't connected (unit tests with no DB) so we
      // never schedule async DB work that triggers an unhandledRejection
      // after the test ends.
      if (
        message.type === "confirm-jump" &&
        result.value.score[playerColor] > room.state.score[playerColor] &&
        mongoose.connection.readyState === 1
      ) {
        const seat = playerColor === "white" ? savedRoom.seats.white : savedRoom.seats.black;
        if (seat?.kind === "account") {
          void checkPieceCapturedAchievement(seat.playerId).catch((err) => {
            console.error("[achievement] onPieceCaptured failed", err);
          });
        }
      }

      // Broadcast live score to tournament participants
      if (savedRoom.tournamentId && savedRoom.tournamentMatchId && this.tournamentCallback) {
        void this.tournamentCallback
          .broadcastLiveScore(
            savedRoom.tournamentId,
            savedRoom.tournamentMatchId,
            savedRoom.state.score,
          )
          .catch((err) => {
            console.error("[game] Tournament live score broadcast failed", err);
          });
      }

      return this.toSnapshot(savedRoom);
    });
  }

  async enterMatchmaking(
    player: PlayerIdentity,
    timeControl: TimeControl = null,
  ): Promise<MatchmakingState> {
    return this.withLock(this.matchmakingLockKey(), async () => {
      // Clear any previous match so the player re-enters the queue
      // instead of being reconnected to the same game.
      await this.matchmaking.deleteMatch(player.playerId);

      const existingEntry = await this.matchmaking.findEntry(player.playerId);
      if (existingEntry) {
        return {
          status: "searching",
          queuedAt: new Date(existingEntry.queuedAt).toISOString(),
          timeControl: existingEntry.timeControl,
        };
      }

      const playerRating = player.rating ?? DEFAULT_RATING;
      const opponentEntry = await this.matchmaking.findAndRemoveOpponent(
        player.playerId,
        timeControl,
        playerRating,
      );

      if (opponentEntry) {
        const snapshot = await this.withLocks(
          [this.playerLockKey(player.playerId), this.playerLockKey(opponentEntry.player.playerId)],
          async () => {
            const slimOpponent: StoredPlayerIdentity = {
              playerId: opponentEntry.player.playerId,
              displayName: opponentEntry.player.displayName,
              kind: opponentEntry.player.kind,
            };
            const slimPlayer: StoredPlayerIdentity = {
              playerId: player.playerId,
              displayName: player.displayName,
              kind: player.kind,
            };
            const room = await this.createRoomRecord({
              roomType: "matchmaking",
              assignSeats: true,
              seats: this.assignSeats(slimOpponent, slimPlayer),
              timeControl,
            });

            await this.matchmaking.setMatch(opponentEntry.player.playerId, room.id);
            await this.matchmaking.setMatch(player.playerId, room.id);

            return this.toSnapshot(room);
          },
        );

        // Push `matchmaking:matched` to the waiting opponent. The caller
        // (`player`) gets the snapshot via the `matched` return value, so
        // they don't need the push — we only need to wake up the player
        // whose queue entry was resolved by this call. We broadcast by
        // playerId (from the opponent queue entry) rather than digging into
        // `snapshot.seats`, which isn't reliably enriched for guests.
        this.matchmakingSocketByPlayer.delete(opponentEntry.player.playerId);
        this.broadcastLobby(opponentEntry.player.playerId, {
          type: "matchmaking:matched",
          snapshot,
        });

        return {
          status: "matched",
          snapshot,
        };
      }

      const queuedAt = Date.now();
      await this.matchmaking.addToQueue({
        player,
        queuedAt,
        timeControl,
        rating: playerRating,
      });

      return {
        status: "searching",
        queuedAt: new Date(queuedAt).toISOString(),
        timeControl,
      };
    });
  }

  async getMatchmakingState(player: PlayerIdentity): Promise<MatchmakingState> {
    return this.withLock(this.matchmakingLockKey(), async () => {
      const matchedGameId = await this.matchmaking.getMatch(player.playerId);
      if (matchedGameId) {
        return {
          status: "matched",
          snapshot: await this.getSnapshot(matchedGameId),
        };
      }

      const existingEntry = await this.matchmaking.findEntry(player.playerId);
      if (existingEntry) {
        return {
          status: "searching",
          queuedAt: new Date(existingEntry.queuedAt).toISOString(),
        };
      }

      return {
        status: "idle",
      };
    });
  }

  async leaveMatchmaking(player: PlayerIdentity): Promise<void> {
    await this.withLock(this.matchmakingLockKey(), async () => {
      await this.matchmaking.removeFromQueue(player.playerId);
      await this.matchmaking.deleteMatch(player.playerId);
    });
  }

  /**
   * Enter matchmaking through a specific lobby socket. Tracks the socket as the
   * owner of the player's matchmaking session so that closing the tab clears
   * the queue entry. If the player already has an active session on a
   * *different* socket (e.g. second matchmaking tab), the old session is
   * evicted first: the old socket is notified with `matchmaking:state { idle }`
   * and its queue entry is removed before the new one is created.
   */
  async enterMatchmakingViaSocket(
    player: PlayerIdentity,
    timeControl: TimeControl,
    socket: WebSocket,
  ): Promise<MatchmakingState> {
    const existingSocket = this.matchmakingSocketByPlayer.get(player.playerId);
    if (existingSocket && existingSocket !== socket) {
      this.matchmakingSocketByPlayer.delete(player.playerId);
      await this.leaveMatchmaking(player);
      // Tell the old socket it was pre-empted (NOT a plain idle state) so the
      // client can distinguish "user cancelled" from "another tab took over"
      // and skip its auto-re-enter effect — otherwise the two tabs ping-pong
      // the queue ownership indefinitely.
      this.sendLobbyMessage(existingSocket, { type: "matchmaking:preempted" });
    }

    const state = await this.enterMatchmaking(player, timeControl);

    if (state.status === "searching") {
      this.matchmakingSocketByPlayer.set(player.playerId, socket);
    } else if (state.status === "matched") {
      // `enterMatchmaking` already pushed `matchmaking:matched` to the
      // waiting opponent. The initiator (this socket) receives the result
      // via the caller's `matchmaking:state` reply in `handleLobbyMessage`.
      this.matchmakingSocketByPlayer.delete(player.playerId);
    }

    return state;
  }

  async leaveMatchmakingViaSocket(player: PlayerIdentity, socket: WebSocket): Promise<void> {
    // Only act if this is the socket that owns the session. A stray leave from
    // a socket that isn't the session owner is silently ignored to avoid
    // clobbering a queue entry owned by a different tab.
    if (this.matchmakingSocketByPlayer.get(player.playerId) !== socket) return;
    this.matchmakingSocketByPlayer.delete(player.playerId);
    await this.leaveMatchmaking(player);
  }

  /** Periodically re-check the queue for players whose Elo windows have expanded enough to match. */
  startMatchmakingSweep(intervalMs = 5_000): void {
    if (this.matchmakingSweepTimer) return;
    this.matchmakingSweepTimer = setInterval(() => {
      void this.sweepMatchmakingQueue();
    }, intervalMs);
    if (this.matchmakingSweepTimer.unref) this.matchmakingSweepTimer.unref();
  }

  stopMatchmakingSweep(): void {
    if (this.matchmakingSweepTimer) {
      clearInterval(this.matchmakingSweepTimer);
      this.matchmakingSweepTimer = null;
    }
  }

  private async sweepMatchmakingQueue(): Promise<void> {
    const matchedPairs: Array<{ room: StoredMultiplayerRoom; playerIds: [string, string] }> = [];

    await this.withLock(this.matchmakingLockKey(), async () => {
      const entries = await this.matchmaking.getAllEntries();
      if (entries.length < 2) return;

      for (const entry of entries) {
        // Re-check if still in queue (may have been matched in this sweep)
        const still = await this.matchmaking.findEntry(entry.player.playerId);
        if (!still) continue;

        const opponent = await this.matchmaking.findAndRemoveOpponent(
          entry.player.playerId,
          entry.timeControl,
          entry.rating,
        );
        if (!opponent) continue;

        // Remove the current entry from queue too
        await this.matchmaking.removeFromQueue(entry.player.playerId);

        // Create game
        const room = await this.withLocks(
          [this.playerLockKey(entry.player.playerId), this.playerLockKey(opponent.player.playerId)],
          async () => {
            const slim1: StoredPlayerIdentity = {
              playerId: entry.player.playerId,
              displayName: entry.player.displayName,
              kind: entry.player.kind,
            };
            const slim2: StoredPlayerIdentity = {
              playerId: opponent.player.playerId,
              displayName: opponent.player.displayName,
              kind: opponent.player.kind,
            };
            const createdRoom = await this.createRoomRecord({
              roomType: "matchmaking",
              assignSeats: true,
              seats: this.assignSeats(slim1, slim2),
              timeControl: entry.timeControl,
            });

            await this.matchmaking.setMatch(entry.player.playerId, createdRoom.id);
            await this.matchmaking.setMatch(opponent.player.playerId, createdRoom.id);

            return createdRoom;
          },
        );

        matchedPairs.push({
          room,
          playerIds: [entry.player.playerId, opponent.player.playerId],
        });
      }
    });

    // Push `matchmaking:matched` to both players for every pair created in this
    // sweep. Doing this outside the lock keeps broadcasts off the hot path and
    // matches the pattern used by other broadcastLobby call sites.
    for (const { room, playerIds } of matchedPairs) {
      const snapshot = await this.toSnapshot(room);
      for (const playerId of playerIds) {
        this.matchmakingSocketByPlayer.delete(playerId);
        this.broadcastLobby(playerId, { type: "matchmaking:matched", snapshot });
      }
    }
  }

  async testForceFinishGame(gameId: string, winner: PlayerColor): Promise<void> {
    if (process.env.NODE_ENV === "production") return;

    return this.withLock(this.roomLockKey(gameId), async () => {
      const room = await this.getRoom(gameId);
      room.state.score[winner] = 10;
      room.status = "finished";
      const savedRoom = await this.saveRoom(room);
      void this.broadcastSnapshot(savedRoom);
    });
  }

  pruneInactiveRooms(_maxIdleMs: number): void {
    // Multiplayer history is persisted, so rooms are intentionally retained.
  }

  private async createRoomRecord(options: {
    roomType: MultiplayerRoomType;
    assignSeats: boolean;
    seats?: StoredSeatAssignments;
    timeControl?: TimeControl;
    gameSettings?: Partial<GameSettings>;
  }): Promise<StoredMultiplayerRoom> {
    const tc = options.timeControl ?? null;
    const clockMs = tc ? { white: tc.initialMs, black: tc.initialMs } : null;

    // Set a first-move deadline for timed games that start with both players seated
    const seats = options.seats ?? { white: null, black: null };
    const willBeActive = options.assignSeats && seats.white && seats.black;
    const firstMoveDeadline =
      tc && willBeActive ? new Date(Date.now() + FIRST_MOVE_TIMEOUT_MS) : null;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const room = this.deriveRoomStatus({
        id: this.generateRoomId(),
        roomType: options.roomType,
        status: "waiting",
        state: createInitialGameState(options.gameSettings),
        rematch: null,
        takeback: null,
        seats,
        timeControl: tc,
        clockMs,
        lastMoveAt: null,
        firstMoveDeadline,
        ratingBefore: null,
        ratingAfter: null,
        ratingStatus: null,
        tournamentId: null,
        tournamentMatchId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      try {
        const createdRoom = await this.store.createRoom({
          id: room.id,
          roomType: room.roomType,
          status: room.status,
          state: room.state,
          rematch: room.rematch,
          takeback: room.takeback,
          seats: room.seats,
          timeControl: room.timeControl,
          clockMs: room.clockMs,
          lastMoveAt: room.lastMoveAt,
          firstMoveDeadline: room.firstMoveDeadline,
        });

        // Schedule first-move timer for timed games
        if (createdRoom.firstMoveDeadline) {
          this.scheduleFirstMoveTimer(createdRoom);
        }

        return createdRoom;
      } catch (error) {
        if (this.isDuplicateRoomError(error)) {
          continue;
        }

        throw error;
      }
    }

    throw new GameServiceError(
      500,
      "ROOM_CREATE_FAILED",
      "Unable to create a multiplayer room right now.",
    );
  }

  private assignSeats(
    firstPlayer: StoredPlayerIdentity,
    secondPlayer: StoredPlayerIdentity,
  ): StoredSeatAssignments {
    if (this.seatRandom() < 0.5) {
      return {
        white: firstPlayer,
        black: secondPlayer,
      };
    }

    return {
      white: secondPlayer,
      black: firstPlayer,
    };
  }

  private async joinRoom(
    room: StoredMultiplayerRoom,
    player: PlayerIdentity,
  ): Promise<StoredMultiplayerRoom> {
    if (this.isPlayerInRoom(room, player.playerId)) {
      return room;
    }

    if (room.seats.white && room.seats.black) {
      throw new GameServiceError(409, "ROOM_FULL", "That game already has two players.");
    }

    const slimPlayer: StoredPlayerIdentity = {
      playerId: player.playerId,
      displayName: player.displayName,
      kind: player.kind,
    };

    let seats: StoredSeatAssignments;
    if (!room.seats.white && !room.seats.black) {
      // Neither seat taken — shouldn't happen normally, but handle it
      seats = { white: slimPlayer, black: null };
    } else {
      // One seat pre-filled (creator) — assign joiner to the empty seat
      seats = {
        white: room.seats.white ?? slimPlayer,
        black: room.seats.black ?? slimPlayer,
      };
    }

    return this.saveRoom({
      ...room,
      seats,
    });
  }

  private isPlayerInRoom(room: StoredMultiplayerRoom, playerId: string): boolean {
    return room.seats.white?.playerId === playerId || room.seats.black?.playerId === playerId;
  }

  private async getRoom(gameId: string): Promise<StoredMultiplayerRoom> {
    const room = await this.store.getRoom(gameId);

    if (!room) {
      throw new GameServiceError(404, "ROOM_NOT_FOUND", "Game not found.");
    }

    return this.deriveRoomStatus(room);
  }

  private async saveRoom(room: StoredMultiplayerRoom): Promise<StoredMultiplayerRoom> {
    const previousStatus = room.status;
    const saved = this.deriveRoomStatus(await this.store.saveRoom(this.deriveRoomStatus(room)));

    // Fire tournament callback when a tournament game finishes
    if (
      saved.status === "finished" &&
      previousStatus !== "finished" &&
      saved.roomType === "tournament" &&
      saved.tournamentId &&
      this.tournamentCallback
    ) {
      // Fire asynchronously to avoid blocking the save path
      void this.tournamentCallback.onGameCompleted(saved.id).catch((err) => {
        console.error("[game] Tournament callback failed for room", saved.id, err);
      });
    }

    // Update Elo ratings when any multiplayer game finishes, then check achievements
    if (saved.status === "finished" && previousStatus !== "finished") {
      saved.ratingStatus = "pending";
      void this.updateEloRatings(saved)
        .catch((err) => {
          console.error("[game] Elo update failed for room", saved.id, err);
        })
        .finally(() => {
          // Check achievements after ELO update so gamesPlayed is already incremented
          void checkGameAchievements({ room: saved }).catch((err) => {
            console.error("[game] Achievement check failed for room", saved.id, err);
          });
        });
    }

    return saved;
  }

  private async updateEloRatings(room: StoredMultiplayerRoom): Promise<void> {
    const whitePlayer = room.seats.white;
    const blackPlayer = room.seats.black;

    // Only rate games where both players are accounts with valid IDs
    if (
      !whitePlayer ||
      !blackPlayer ||
      whitePlayer.kind !== "account" ||
      blackPlayer.kind !== "account" ||
      !isValidObjectId(whitePlayer.playerId) ||
      !isValidObjectId(blackPlayer.playerId)
    ) {
      return;
    }

    const winner = getWinner(room.state);
    const scoreWhite = winner === "white" ? 1.0 : winner === "black" ? 0.0 : 0.5;

    const [whiteAccount, blackAccount] = await Promise.all([
      GameAccount.findById(whitePlayer.playerId),
      GameAccount.findById(blackPlayer.playerId),
    ]);

    if (!whiteAccount || !blackAccount) return;

    const whiteElo = whiteAccount.rating?.overall?.elo ?? DEFAULT_RATING;
    const blackElo = blackAccount.rating?.overall?.elo ?? DEFAULT_RATING;
    const whiteGames = whiteAccount.rating?.overall?.gamesPlayed ?? 0;
    const blackGames = blackAccount.rating?.overall?.gamesPlayed ?? 0;

    const { newRatingA, newRatingB } = computeNewRatings(
      whiteElo,
      whiteGames,
      blackElo,
      blackGames,
      scoreWhite,
    );

    await Promise.all([
      GameAccount.findByIdAndUpdate(whitePlayer.playerId, {
        $set: { "rating.overall.elo": newRatingA },
        $inc: { "rating.overall.gamesPlayed": 1 },
      }),
      GameAccount.findByIdAndUpdate(blackPlayer.playerId, {
        $set: { "rating.overall.elo": newRatingB },
        $inc: { "rating.overall.gamesPlayed": 1 },
      }),
    ]);

    // Store rating snapshots on the room
    room.ratingBefore = { white: whiteElo, black: blackElo };
    room.ratingAfter = { white: newRatingA, black: newRatingB };
    room.ratingStatus = "completed";

    // Invalidate cached profiles so the snapshot picks up new ratings
    invalidatePlayerProfile(whitePlayer.playerId);
    invalidatePlayerProfile(blackPlayer.playerId);

    // Check ranking-based achievements for both players
    void this.checkRankingAchievements(whitePlayer.playerId, newRatingA);
    void this.checkRankingAchievements(blackPlayer.playerId, newRatingB);

    await this.store.saveRoom(room);

    console.log(
      `[game] Elo updated for room ${room.id}: white ${whiteElo}->${newRatingA}, black ${blackElo}->${newRatingB}`,
    );

    // Re-broadcast the snapshot so clients receive the rating data
    void this.broadcastSnapshot(room);
  }

  private async checkRankingAchievements(playerId: string, newElo: number): Promise<void> {
    try {
      const totalPlayers = await GameAccount.countDocuments({
        "rating.overall.gamesPlayed": { $gte: 1 },
      });
      if (totalPlayers === 0) return;
      const playersBelow = await GameAccount.countDocuments({
        "rating.overall.gamesPlayed": { $gte: 1 },
        "rating.overall.elo": { $lt: newElo },
      });
      const percentile = Math.round((playersBelow / totalPlayers) * 100);
      await checkEloAchievements({ playerId, newElo, percentile });
    } catch (err) {
      console.error("[game] Ranking achievement check failed for", playerId, err);
    }
  }

  private deriveRoomStatus(room: StoredMultiplayerRoom): StoredMultiplayerRoom {
    const seats = {
      white: room.seats.white ? { ...room.seats.white } : null,
      black: room.seats.black ? { ...room.seats.black } : null,
    };
    const status = this.getStatus(room.state, seats);
    const rematch = status === "finished" ? this.normalizeRematch(room.rematch, seats) : null;

    // Clear takeback state if game is not active
    const takeback = status === "active" ? (room.takeback ?? null) : null;

    return {
      ...room,
      roomType: room.roomType ?? "direct",
      rematch,
      takeback,
      seats,
      status,
    };
  }

  private normalizeRematch(
    rematch: MultiplayerRematchState | null,
    seats: StoredSeatAssignments,
  ): MultiplayerRematchState | null {
    if (!rematch) {
      return null;
    }

    const activeColors = (["white", "black"] as PlayerColor[]).filter((color) => !!seats[color]);
    const requestedBy = rematch.requestedBy.filter((color) => activeColors.includes(color));

    if (requestedBy.length === 0) {
      return null;
    }

    return {
      requestedBy,
    };
  }

  private getStatus(
    state: StoredMultiplayerRoom["state"],
    seats: StoredSeatAssignments,
  ): MultiplayerStatus {
    if (isGameOver(state)) {
      return "finished";
    }

    if (seats.white && seats.black) {
      return "active";
    }

    return "waiting";
  }

  private isPlayerOnline(roomId: string, playerId: string): boolean {
    return Array.from(this.getConnections(roomId).values()).includes(playerId);
  }

  private areBothPlayersConnected(room: StoredMultiplayerRoom): boolean {
    const conns = this.connections.get(room.id);
    if (!conns) return false;
    const connected = new Set(conns.values());
    const whiteId = room.seats.white?.playerId;
    const blackId = room.seats.black?.playerId;
    return !!(whiteId && blackId && connected.has(whiteId) && connected.has(blackId));
  }

  private toPlayerSlot(roomId: string, player: PlayerIdentity): PlayerSlot {
    return {
      player,
      online: this.isPlayerOnline(roomId, player.playerId),
    };
  }

  /** Resolve a stored slim seat identity into a full PlayerIdentity using cached profile data. */
  private resolveIdentity(
    stored: StoredPlayerIdentity,
    profiles: Map<string, CachedPlayerProfile>,
  ): PlayerIdentity {
    return enrichIdentity(stored, profiles.get(stored.playerId) ?? null);
  }

  /** Batch-resolve profiles for all seated players in a room. */
  private async resolveRoomProfiles(
    room: StoredMultiplayerRoom,
  ): Promise<Map<string, CachedPlayerProfile>> {
    const ids: string[] = [];
    if (room.seats.white) ids.push(room.seats.white.playerId);
    if (room.seats.black) ids.push(room.seats.black.playerId);
    return ids.length > 0 ? getPlayerProfiles(ids) : new Map();
  }

  private async toSnapshot(room: StoredMultiplayerRoom): Promise<MultiplayerSnapshot> {
    const profiles = await this.resolveRoomProfiles(room);

    const roomSpectators = this.spectatorIdentities.get(room.id);
    const spectators: PlayerSlot[] = roomSpectators
      ? Array.from(roomSpectators.values()).map((identity) => this.toPlayerSlot(room.id, identity))
      : [];

    // Build players list from seats (replaces old room.players)
    const players: PlayerSlot[] = [];
    for (const color of ["white", "black"] as const) {
      const seat = room.seats[color];
      if (seat) {
        const identity = this.resolveIdentity(seat, profiles);
        players.push(this.toPlayerSlot(room.id, identity));
      }
    }

    const enrichSeat = (color: PlayerColor): PlayerSlot | null => {
      const seat = room.seats[color];
      if (!seat) return null;
      return this.toPlayerSlot(room.id, this.resolveIdentity(seat, profiles));
    };

    return {
      gameId: room.id,
      roomType: room.roomType,
      status: room.status,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      state: room.state,
      players,
      spectators,
      rematch: room.rematch,
      takeback: room.takeback,
      seats: {
        white: enrichSeat("white"),
        black: enrichSeat("black"),
      },
      timeControl: room.timeControl,
      clock: this.computeLiveClock(room),
      firstMoveDeadline: room.firstMoveDeadline?.toISOString() ?? null,
      tournamentId: room.tournamentId ?? null,
      tournamentReady:
        room.roomType === "tournament"
          ? !!(room.firstMoveDeadline || room.lastMoveAt) || !room.timeControl
          : undefined,
      ratingBefore: room.ratingBefore ?? null,
      ratingAfter: room.ratingAfter ?? null,
    };
  }

  /** Compute live remaining times by subtracting elapsed since lastMoveAt. */
  private computeLiveClock(
    room: StoredMultiplayerRoom,
  ): { white: number; black: number; lastMoveAt: string } | null {
    if (!room.clockMs || !room.timeControl) return null;

    const white = room.clockMs.white;
    const black = room.clockMs.black;

    // Before first move, clocks are frozen — use current time as lastMoveAt
    // so the client doesn't count down
    if (!room.lastMoveAt) {
      return {
        white,
        black,
        lastMoveAt: new Date().toISOString(),
      };
    }

    // If game is active, deduct elapsed time from the current player
    if (room.status === "active") {
      const elapsed = Date.now() - room.lastMoveAt.getTime();
      const current = room.state.currentTurn;
      return {
        white: current === "white" ? Math.max(0, white - elapsed) : white,
        black: current === "black" ? Math.max(0, black - elapsed) : black,
        lastMoveAt: room.lastMoveAt.toISOString(),
      };
    }

    return {
      white,
      black,
      lastMoveAt: room.lastMoveAt.toISOString(),
    };
  }

  private static deriveFinishReason(room: StoredMultiplayerRoom): FinishReason | null {
    if (room.status !== "finished") return null;

    // Scan the entire tail of the history for meta-records.
    // forfeitGame() pushes [forfeit, win] — so we need to check
    // all trailing meta-records, not just the last one.
    const history = room.state.history;
    for (let i = history.length - 1; i >= 0; i--) {
      const record = history[i];
      if (record.type === "forfeit") {
        return record.reason === "timeout" ? "timeout" : "forfeit";
      }
      if (record.type === "draw") {
        return "board_full";
      }
      if (record.type === "win") {
        // Keep scanning — a forfeit record may precede this win
        continue;
      }
      // Hit a board move — stop scanning
      break;
    }

    // If we only found "win" records (no forfeit/draw), it's a score capture
    if (history.some((r) => r.type === "win")) {
      return "captured";
    }

    return null;
  }

  private async toSummary(
    room: StoredMultiplayerRoom,
    playerId: string,
    profiles?: Map<string, CachedPlayerProfile>,
  ): Promise<MultiplayerGameSummary> {
    const profs = profiles ?? (await this.resolveRoomProfiles(room));

    const players: PlayerSlot[] = [];
    for (const color of ["white", "black"] as const) {
      const seat = room.seats[color];
      if (seat) {
        const identity = this.resolveIdentity(seat, profs);
        players.push(this.toPlayerSlot(room.id, identity));
      }
    }

    const enrichSeat = (color: PlayerColor): PlayerSlot | null => {
      const seat = room.seats[color];
      if (!seat) return null;
      return this.toPlayerSlot(room.id, this.resolveIdentity(seat, profs));
    };

    return {
      gameId: room.id,
      roomType: room.roomType,
      status: room.status,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      currentTurn: room.state.currentTurn,
      historyLength: room.state.history.length,
      winner: getWinner(room.state),
      finishReason: GameService.deriveFinishReason(room),
      yourSeat: getPlayerColorForRoom(room, playerId),
      score: {
        black: room.state.score.black,
        white: room.state.score.white,
      },
      players,
      seats: {
        white: enrichSeat("white"),
        black: enrichSeat("black"),
      },
      rematch: room.status === "finished" ? (room.rematch ?? null) : null,
      boardSize: room.state.boardSize,
      scoreToWin: room.state.scoreToWin,
      timeControl: room.timeControl,
      clockMs: room.clockMs ?? null,
      ratingBefore: room.ratingBefore ?? null,
      ratingAfter: room.ratingAfter ?? null,
    };
  }

  private ensureActionableRoom(room: StoredMultiplayerRoom, playerColor: PlayerColor): void {
    if (!room.seats.white || !room.seats.black) {
      throw new GameServiceError(
        409,
        "WAITING_FOR_OPPONENT",
        "The game cannot start until both players have joined.",
      );
    }

    // Block moves in timed tournament games until both players have connected
    if (
      room.roomType === "tournament" &&
      room.timeControl &&
      !room.lastMoveAt &&
      !room.firstMoveDeadline
    ) {
      throw new GameServiceError(
        409,
        "TOURNAMENT_NOT_STARTED",
        "Waiting for both players to connect before the game can begin.",
      );
    }

    if (room.state.currentTurn !== playerColor) {
      throw new GameServiceError(409, "NOT_YOUR_TURN", "It is not your turn.");
    }
  }

  private async requestRematch(
    room: StoredMultiplayerRoom,
    playerColor: PlayerColor,
  ): Promise<StoredMultiplayerRoom> {
    if (room.roomType === "tournament") {
      throw new GameServiceError(
        409,
        "TOURNAMENT_NO_REMATCH",
        "Rematches are not available in tournament games.",
      );
    }

    if (room.status !== "finished") {
      throw new GameServiceError(
        409,
        "GAME_NOT_FINISHED",
        "A rematch is only available once the game has finished.",
      );
    }

    if (!room.seats.white || !room.seats.black) {
      throw new GameServiceError(
        409,
        "WAITING_FOR_OPPONENT",
        "A rematch needs both players to still be seated.",
      );
    }

    // Verify both players' accounts still exist (e.g. opponent may have been deleted).
    // After account deletion the seat displayName is anonymized to DELETED_PLAYER_NAME.
    const opponentColor = playerColor === "white" ? "black" : "white";
    const opponentSeat = room.seats[opponentColor]!;
    if (opponentSeat.displayName === DELETED_PLAYER_NAME) {
      throw new GameServiceError(
        410,
        "OPPONENT_ACCOUNT_DELETED",
        "Your opponent's account no longer exists. A rematch is not possible.",
      );
    }

    const requestedBy = Array.from(new Set([...(room.rematch?.requestedBy ?? []), playerColor]));

    if (requestedBy.length === 2) {
      // Before creating a new game, verify the original requester is still connected.
      // This prevents orphaned game creation when the sender disconnected moments ago.
      // Only enforce when there are active connections (skip in test environments with no sockets).
      const roomHasConnections = (this.connections.get(room.id)?.size ?? 0) > 0;
      if (roomHasConnections) {
        const originalRequester = room.rematch?.requestedBy[0];
        if (originalRequester) {
          const originalPlayerId = room.seats[originalRequester]?.playerId;
          if (originalPlayerId && !this.isPlayerOnline(room.id, originalPlayerId)) {
            // The original requester disconnected — revoke the stale rematch
            await this.saveRoom({ ...room, rematch: null });
            throw new GameServiceError(
              409,
              "REMATCH_EXPIRED",
              "The rematch request has expired because your opponent left.",
            );
          }
        }
      }

      // Both players agreed — create a new game room.
      // Rematch seats are *flipped* deterministically (old white plays black
      // and vice versa) rather than randomized. This lets the invitation UI
      // show the accepter "You would play as {color}" before they accept,
      // and matches the convention used by most online board-game sites.
      const whitePlayer = room.seats.white;
      const blackPlayer = room.seats.black;
      const newRoom = await this.createRoomRecord({
        roomType: room.roomType,
        assignSeats: true,
        seats:
          whitePlayer && blackPlayer
            ? { white: blackPlayer, black: whitePlayer }
            : { white: null, black: null },
        timeControl: room.timeControl ?? undefined,
        gameSettings: {
          boardSize: room.state.boardSize,
          scoreToWin: room.state.scoreToWin,
        },
      });

      // Notify all connections on the OLD room about the new game
      const rematchMessage = JSON.stringify({
        type: "rematch-started",
        gameId: newRoom.id,
      });
      const connections = this.connections.get(room.id);
      if (connections) {
        for (const [socket] of connections.entries()) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(rematchMessage);
          }
        }
      }

      // Also notify via lobby for players who may not be connected to the game
      for (const color of ["white", "black"] as const) {
        const seat = room.seats[color];
        if (seat) {
          void this.toSummary(newRoom, seat.playerId).then((summary) => {
            this.broadcastLobby(seat.playerId, { type: "game-update", summary });
          });
        }
      }

      // Mark old room rematch as null (completed)
      await this.saveRoom({
        ...room,
        rematch: null,
        takeback: null,
      });

      return newRoom;
    }

    const savedRoom = await this.saveRoom({
      ...room,
      rematch: {
        requestedBy,
      },
    });

    // Notify lobby so players who left the game page still see the rematch request
    for (const color of ["white", "black"] as const) {
      const seat = savedRoom.seats[color];
      if (seat) {
        void this.toSummary(savedRoom, seat.playerId).then((summary) => {
          this.broadcastLobby(seat.playerId, { type: "game-update", summary });
        });
      }
    }

    return savedRoom;
  }

  private async declineRematch(
    room: StoredMultiplayerRoom,
    playerColor: PlayerColor,
  ): Promise<StoredMultiplayerRoom> {
    if (room.status !== "finished") {
      throw new GameServiceError(
        409,
        "GAME_NOT_FINISHED",
        "A rematch can only be declined once the game has finished.",
      );
    }

    const incomingRequestExists = (room.rematch?.requestedBy ?? []).some(
      (color) => color !== playerColor,
    );

    if (!incomingRequestExists) {
      throw new GameServiceError(
        409,
        "NO_REMATCH_REQUEST",
        "There is no incoming rematch request to decline.",
      );
    }

    const savedRoom = await this.saveRoom({
      ...room,
      rematch: null,
    });

    // Notify lobby so players who left the game page see the decline
    for (const color of ["white", "black"] as const) {
      const seat = savedRoom.seats[color];
      if (seat) {
        void this.toSummary(savedRoom, seat.playerId).then((summary) => {
          this.broadcastLobby(seat.playerId, { type: "game-update", summary });
        });
      }
    }

    return savedRoom;
  }

  private async cancelRematch(
    room: StoredMultiplayerRoom,
    playerColor: PlayerColor,
  ): Promise<StoredMultiplayerRoom> {
    if (room.status !== "finished") {
      throw new GameServiceError(
        409,
        "GAME_NOT_FINISHED",
        "Cannot cancel a rematch on a game that is not finished.",
      );
    }

    const myRequestExists = (room.rematch?.requestedBy ?? []).includes(playerColor);
    if (!myRequestExists) {
      // Nothing to cancel — no-op, just return current state
      return room;
    }

    const savedRoom = await this.saveRoom({
      ...room,
      rematch: null,
    });

    // Notify lobby so players who left the game page see the cancellation
    for (const color of ["white", "black"] as const) {
      const seat = savedRoom.seats[color];
      if (seat) {
        void this.toSummary(savedRoom, seat.playerId).then((summary) => {
          this.broadcastLobby(seat.playerId, { type: "game-update", summary });
        });
      }
    }

    return savedRoom;
  }

  /**
   * When a player fully disconnects from the lobby, revoke any pending rematch
   * on their finished games — regardless of whether *they* were the sender or
   * the receiver. Both cases produce a stale rematch:
   *  - Sender leaves: receiver should not be able to accept anymore.
   *  - Receiver leaves: sender's "waiting for opponent" state never clears,
   *    and pushPendingRematches would re-deliver the rematch to the receiver
   *    as a brand-new toast on reconnect.
   * This mirrors the per-room disconnect logic but covers the case where the
   * player leaves the site entirely (closing the lobby socket) without first
   * disconnecting from each game room socket.
   */
  private async revokeRematchesOnDisconnect(playerId: string): Promise<void> {
    try {
      const rooms = await this.store.listRoomsForPlayer(playerId);
      for (const room of rooms) {
        if (room.status !== "finished" || !room.rematch?.requestedBy.length) continue;
        const playerColor = getPlayerColorForRoom(room, playerId);
        if (!playerColor) continue;

        // Use the room lock to prevent races with concurrent rematch acceptance
        const savedRoom = await this.withLock(this.roomLockKey(room.id), async () => {
          const freshRoom = this.deriveRoomStatus(await this.getRoom(room.id));
          if (!freshRoom.rematch?.requestedBy.length) return freshRoom;
          const color = getPlayerColorForRoom(freshRoom, playerId);
          if (!color) return freshRoom;
          return this.saveRoom({ ...freshRoom, rematch: null });
        });

        void this.broadcastSnapshot(savedRoom);
        // Also notify lobby connections so the opponent's UI updates
        for (const color of ["white", "black"] as const) {
          const seat = savedRoom.seats[color];
          if (seat) {
            void this.toSummary(savedRoom, seat.playerId).then((summary) => {
              this.broadcastLobby(seat.playerId, { type: "game-update", summary });
            });
          }
        }
      }
    } catch {
      /* best-effort — don't let revocation errors break the disconnect flow */
    }
  }

  private async requestTakeback(
    room: StoredMultiplayerRoom,
    playerColor: PlayerColor,
  ): Promise<StoredMultiplayerRoom> {
    if (room.status !== "active") {
      throw new GameServiceError(
        409,
        "GAME_NOT_ACTIVE",
        "Takebacks are only available during an active game.",
      );
    }

    if (room.state.history.length === 0) {
      throw new GameServiceError(409, "NO_MOVES", "There are no moves to take back.");
    }

    if (room.takeback?.requestedBy) {
      throw new GameServiceError(409, "TAKEBACK_PENDING", "A takeback request is already pending.");
    }

    const declinedCount = room.takeback?.declinedCount ?? { white: 0, black: 0 };
    if (declinedCount[playerColor] >= 3) {
      throw new GameServiceError(
        409,
        "TAKEBACK_LIMIT",
        "You have used all your takeback requests. Make a move to reset.",
      );
    }

    return this.saveRoom({
      ...room,
      takeback: {
        requestedBy: playerColor,
        declinedCount,
      },
    });
  }

  private async acceptTakeback(
    room: StoredMultiplayerRoom,
    playerColor: PlayerColor,
  ): Promise<StoredMultiplayerRoom> {
    if (!room.takeback?.requestedBy) {
      throw new GameServiceError(
        409,
        "NO_TAKEBACK_REQUEST",
        "There is no takeback request to accept.",
      );
    }

    if (room.takeback.requestedBy === playerColor) {
      throw new GameServiceError(
        409,
        "OWN_TAKEBACK",
        "You cannot accept your own takeback request.",
      );
    }

    // Undo the last move by the requester.
    // If it's currently the requester's turn, undo their opponent's last move
    // then undo the requester's move. If it's the opponent's turn, just undo
    // the requester's last move.
    let state = room.state;
    const requester = room.takeback.requestedBy;
    const clockMs = room.clockMs ? { ...room.clockMs } : null;
    let lastMoveAt = room.lastMoveAt;
    const increment = room.timeControl?.incrementMs ?? 0;

    // Helper to reverse clock changes for an undone move
    const reverseClock = (undoneMove: TurnRecord, prevTimestamp: number | null) => {
      if (undoneMove.type !== "put" && undoneMove.type !== "jump") return;
      if (!clockMs || !undoneMove.timestamp) return;
      // Remove the increment that was added after this move
      clockMs[undoneMove.color] = Math.max(0, clockMs[undoneMove.color] - increment);
      // Give back the time that was deducted for this move
      if (prevTimestamp) {
        const elapsed = undoneMove.timestamp - prevTimestamp;
        clockMs[undoneMove.color] += elapsed;
      }
    };

    // Find the timestamp of the move before the ones being undone
    const getPrevTimestamp = (history: typeof state.history, idx: number): number | null => {
      for (let i = idx - 1; i >= 0; i--) {
        const rec = history[i];
        if ((rec.type === "put" || rec.type === "jump") && rec.timestamp) {
          return rec.timestamp;
        }
      }
      return null;
    };

    if (state.currentTurn !== requester && state.history.length > 0) {
      // It's the accepting player's turn, meaning the requester's move was
      // the one before. Just undo the last move.
      const lastMove = state.history[state.history.length - 1];
      const prevTs = getPrevTimestamp(state.history, state.history.length - 1);
      const undo = undoLastTurn(state);
      if (!undo.ok) {
        throw new GameServiceError(409, undo.code, undo.reason);
      }
      reverseClock(lastMove, prevTs);
      // Reset lastMoveAt to now so the restored clock values aren't
      // immediately eroded by computeLiveClock subtracting stale elapsed time.
      lastMoveAt = new Date();
      state = undo.value;
    } else if (state.currentTurn === requester && state.history.length >= 2) {
      // It's the requester's turn, so undo the accepting player's move first,
      // then undo the requester's previous move.
      const lastMove = state.history[state.history.length - 1];
      const prevTs1 = getPrevTimestamp(state.history, state.history.length - 1);
      const undo1 = undoLastTurn(state);
      if (!undo1.ok) {
        throw new GameServiceError(409, undo1.code, undo1.reason);
      }
      reverseClock(lastMove, prevTs1);
      state = undo1.value;

      const secondLastMove = state.history[state.history.length - 1];
      const prevTs2 = getPrevTimestamp(state.history, state.history.length - 1);
      const undo2 = undoLastTurn(state);
      if (!undo2.ok) {
        throw new GameServiceError(409, undo2.code, undo2.reason);
      }
      reverseClock(secondLastMove, prevTs2);
      lastMoveAt = new Date();
      state = undo2.value;
    }

    return this.saveRoom({
      ...room,
      state,
      clockMs,
      lastMoveAt,
      takeback: null,
    });
  }

  private async declineTakeback(
    room: StoredMultiplayerRoom,
    playerColor: PlayerColor,
  ): Promise<StoredMultiplayerRoom> {
    if (!room.takeback?.requestedBy) {
      throw new GameServiceError(
        409,
        "NO_TAKEBACK_REQUEST",
        "There is no takeback request to decline.",
      );
    }

    if (room.takeback.requestedBy === playerColor) {
      throw new GameServiceError(
        409,
        "OWN_TAKEBACK",
        "You cannot decline your own takeback request.",
      );
    }

    const requester = room.takeback.requestedBy;
    const declinedCount = { ...room.takeback.declinedCount };
    declinedCount[requester] = (declinedCount[requester] || 0) + 1;

    return this.saveRoom({
      ...room,
      takeback: {
        requestedBy: null,
        declinedCount,
      },
    });
  }

  private async broadcastSnapshot(room: StoredMultiplayerRoom): Promise<void> {
    const profiles = await this.resolveRoomProfiles(room);
    const snapshot = await this.toSnapshot(room);
    const message = JSON.stringify({
      type: "snapshot",
      snapshot,
    });

    // Notify active game connections
    const connections = this.connections.get(room.id);
    if (connections && connections.size > 0) {
      for (const [socket] of connections.entries()) {
        if (socket.readyState !== WebSocket.OPEN) {
          connections.delete(socket);
          this.socketRooms.delete(socket);
          continue;
        }

        socket.send(message);
      }

      if (connections.size === 0) {
        this.connections.delete(room.id);
      }
    }

    // Also notify lobby for seated players
    for (const color of ["white", "black"] as const) {
      const seat = room.seats[color];
      if (seat) {
        const summary = await this.toSummary(room, seat.playerId, profiles);
        this.broadcastLobby(seat.playerId, {
          type: "game-update",
          summary,
        });
      }
    }
  }

  private getConnections(roomId: string): RoomConnections {
    let connections = this.connections.get(roomId);
    if (!connections) {
      connections = new Map();
      this.connections.set(roomId, connections);
    }

    return connections;
  }

  private generateRoomId(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 6 }, () => {
      const index = Math.floor(Math.random() * alphabet.length);
      return alphabet[index];
    }).join("");
  }

  private isDuplicateRoomError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
  }

  private abandonTimerKey(roomId: string, playerId: string): string {
    return `${roomId}:${playerId}`;
  }

  private startAbandonTimer(roomId: string, playerId: string): void {
    const key = this.abandonTimerKey(roomId, playerId);
    if (this.guestAbandonTimers.has(key)) {
      return;
    }

    const timer = setTimeout(() => {
      void this.abandonGame(roomId, playerId);
    }, this.abandonTimeoutMs);

    timer.unref?.();
    this.guestAbandonTimers.set(key, timer);
  }

  private clearAbandonTimer(roomId: string, playerId: string): void {
    const key = this.abandonTimerKey(roomId, playerId);
    const timer = this.guestAbandonTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.guestAbandonTimers.delete(key);
    }
  }

  private async abandonGame(roomId: string, playerId: string): Promise<void> {
    this.guestAbandonTimers.delete(this.abandonTimerKey(roomId, playerId));

    try {
      await this.withLock(this.roomLockKey(roomId), async () => {
        const room = await this.store.getRoom(roomId);
        if (!room) return;

        const derived = this.deriveRoomStatus(room);
        if (derived.status !== "active") return;

        // Only abandon if the guest is still offline
        if (this.isPlayerOnline(roomId, playerId)) return;

        const playerColor = getPlayerColorForRoom(derived, playerId);
        if (!playerColor) return;

        const abandonResult = forfeitGame(derived.state, playerColor, "forfeit");
        if (!abandonResult.ok) return;
        derived.state = abandonResult.value;
        const savedRoom = await this.saveRoom(derived);
        void this.broadcastSnapshot(savedRoom);
      });
    } catch {
      // Best-effort cleanup; don't crash the server.
    }
  }

  // ─── Clock Timers ────────────────────────────────────────────────────

  private scheduleClockTimer(room: StoredMultiplayerRoom): void {
    this.clearClockTimer(room.id);

    if (
      !room.clockMs ||
      !room.timeControl ||
      room.status !== "active" ||
      !room.lastMoveAt ||
      isGameOver(room.state)
    ) {
      return;
    }

    const currentPlayer = room.state.currentTurn;
    const remainingMs = room.clockMs[currentPlayer];

    if (remainingMs <= 0) return;

    const timer = setTimeout(async () => {
      try {
        await this.withLock(this.roomLockKey(room.id), async () => {
          const freshRoom = await this.getRoom(room.id);
          if (freshRoom.status !== "active" || isGameOver(freshRoom.state)) return;
          if (!freshRoom.clockMs || !freshRoom.lastMoveAt) return;

          const elapsed = Date.now() - freshRoom.lastMoveAt.getTime();
          const playerTime = freshRoom.clockMs[freshRoom.state.currentTurn] - elapsed;

          if (playerTime > 0) return; // Not actually expired

          const flagColor = freshRoom.state.currentTurn;
          const flagResult = forfeitGame(freshRoom.state, flagColor, "timeout");
          if (!flagResult.ok) return;

          freshRoom.clockMs[flagColor] = 0;
          const savedRoom = await this.saveRoom({
            ...freshRoom,
            state: flagResult.value,
            clockMs: freshRoom.clockMs,
            lastMoveAt: new Date(),
          });

          void this.broadcastSnapshot(savedRoom);
        });
      } catch {
        // Best-effort; don't crash the server.
      }
    }, remainingMs + 100); // Small buffer to avoid race conditions

    timer.unref();
    this.clockTimers.set(room.id, timer);
  }

  private clearClockTimer(roomId: string): void {
    const timer = this.clockTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.clockTimers.delete(roomId);
    }
  }

  /**
   * Restore clock timers for all active timed games.
   * Called on server startup to recover in-memory timers lost during restart.
   * Also handles games where time already expired while the server was down.
   */
  async restoreClockTimers(): Promise<void> {
    const rooms = await this.store.findActiveTimedRooms();
    let scheduled = 0;

    for (const room of rooms) {
      if (this.clockTimers.has(room.id)) continue;
      this.scheduleClockTimer(this.deriveRoomStatus(room));
      scheduled++;
    }

    if (scheduled > 0) {
      console.info(`[game] Restored clock timers for ${scheduled} active timed game(s)`);
    }
  }

  // ─── First-Move Timers ──────────────────────────────────────────────

  private scheduleFirstMoveTimer(room: StoredMultiplayerRoom): void {
    this.clearFirstMoveTimer(room.id);

    if (!room.firstMoveDeadline || !room.timeControl || room.status !== "active") {
      return;
    }

    const remainingMs = room.firstMoveDeadline.getTime() - Date.now();
    if (remainingMs <= 0) return;

    const timer = setTimeout(async () => {
      try {
        await this.abortGameForFirstMoveTimeout(room.id);
      } catch {
        // Best-effort; don't crash the server.
      }
    }, remainingMs + 100);

    timer.unref();
    this.firstMoveTimers.set(room.id, timer);
  }

  private clearFirstMoveTimer(roomId: string): void {
    const timer = this.firstMoveTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.firstMoveTimers.delete(roomId);
    }
  }

  private async abortGameForFirstMoveTimeout(roomId: string): Promise<void> {
    this.firstMoveTimers.delete(roomId);

    await this.withLock(this.roomLockKey(roomId), async () => {
      const room = await this.store.getRoom(roomId);
      if (!room) return;

      const derived = this.deriveRoomStatus(room);
      if (derived.status !== "active") return;

      // Only abort if the first move still hasn't been made
      if (derived.lastMoveAt || !derived.firstMoveDeadline) return;

      // Check if deadline actually passed
      if (derived.firstMoveDeadline.getTime() > Date.now()) return;

      // The player who hasn't moved is currentTurn (white goes first)
      const absentColor = derived.state.currentTurn;
      const opponentColor: PlayerColor = absentColor === "white" ? "black" : "white";

      // Mark the game as finished via timeout forfeit
      const timeoutResult = forfeitGame(derived.state, absentColor, "timeout");
      if (!timeoutResult.ok) return;
      derived.state = timeoutResult.value;
      const savedRoom = await this.saveRoom({
        ...derived,
        firstMoveDeadline: null,
      });
      this.clearClockTimer(roomId);

      // Determine who to requeue: the opponent (they didn't do anything wrong)
      const opponentPlayer = derived.seats[opponentColor];
      const isTournament = derived.roomType === "tournament";
      const timeoutSeconds = isTournament ? 60 : 30;

      // Send game-aborted message to all connections
      const connections = this.connections.get(roomId);
      if (connections) {
        for (const [socket, playerId] of connections.entries()) {
          if (socket.readyState !== WebSocket.OPEN) continue;

          const playerColor = getPlayerColorForRoom(derived, playerId);
          const isAbsentPlayer = playerColor === absentColor;

          socket.send(
            JSON.stringify({
              type: "game-aborted",
              reason: isAbsentPlayer
                ? `You did not make a move within ${timeoutSeconds} seconds. The game has been cancelled.`
                : isTournament
                  ? "Your opponent did not make a move in time. The match has been forfeited."
                  : "Your opponent did not make a move in time. Finding you a new match...",
              requeuedForMatchmaking: isTournament ? false : !isAbsentPlayer,
              timeControl: derived.timeControl,
            }),
          );
        }
      }

      // Broadcast updated snapshot so game shows as finished
      void this.broadcastSnapshot(savedRoom);

      // Re-enter the opponent into matchmaking (skip for tournament games)
      if (!isTournament && opponentPlayer) {
        try {
          await this.enterMatchmaking(opponentPlayer, derived.timeControl);
        } catch {
          // Best-effort requeue
        }
      }
    });
  }

  private validatePosition(position: unknown): asserts position is { x: number; y: number } {
    if (
      !position ||
      typeof position !== "object" ||
      typeof (position as Record<string, unknown>).x !== "number" ||
      typeof (position as Record<string, unknown>).y !== "number"
    ) {
      throw new GameServiceError(400, "INVALID_POSITION", "Invalid board position.");
    }
  }

  private matchmakingLockKey(): string {
    return "matchmaking";
  }

  private playerLockKey(playerId: string): string {
    return `player:${playerId}`;
  }

  private roomLockKey(gameId: string): string {
    return `room:${gameId.trim().toUpperCase()}`;
  }

  private async withLocks<T>(keys: string[], operation: () => Promise<T>): Promise<T> {
    const uniqueKeys = Array.from(new Set(keys)).sort();

    const run = (index: number): Promise<T> => {
      if (index >= uniqueKeys.length) {
        return operation();
      }
      return this.withLock(uniqueKeys[index], () => run(index + 1));
    };

    return run(0);
  }

  private withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    return this.lockProvider.withLock(key, operation);
  }
}

import { getRedisClient } from "../config/redisClient";
import { RedisLockProvider } from "./lockProvider";
import { RedisMatchmakingStore } from "./matchmakingStore";

function createGameService(): GameService {
  const redis = getRedisClient();
  if (redis) {
    console.info("[game] Using Redis-backed matchmaking and locks.");
    return new GameService(
      new MongoGameRoomStore(),
      Math.random,
      GUEST_ABANDON_TIMEOUT_MS,
      new RedisMatchmakingStore(redis),
      new RedisLockProvider(redis),
    );
  }

  return new GameService();
}

export const gameService = createGameService();

// Wire achievement notifications through the lobby WebSocket.
// Only `id`, `tier`, and `secret` ship — the client resolves the localized
// name/description via next-intl so the broadcast is locale-agnostic.
setAchievementNotifier((playerId, achievement) => {
  gameService.broadcastLobby(playerId, {
    type: "achievement-unlocked",
    achievement: {
      id: achievement.id,
      tier: achievement.tier,
      secret: achievement.secret,
    },
  });
});

// Wire achievement change notifications (for revokes) through the lobby WebSocket
setAchievementChangeNotifier((playerId) => {
  gameService.broadcastLobby(playerId, { type: "achievement-changed" });
});
