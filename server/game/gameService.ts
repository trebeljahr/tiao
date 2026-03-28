import WebSocket from "ws";
import {
  ClientToServerMessage,
  FinishReason,
  MatchmakingState,
  MultiplayerGameSummary,
  MultiplayerGamesIndex,
  MultiplayerRematchState,
  MultiplayerRoomType,
  MultiplayerSeatAssignments,
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
  getPlayerColorForRoom,
} from "./gameStore";

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
import {
  InMemoryMatchmakingStore,
  MatchmakingStore,
} from "./matchmakingStore";
import { computeNewRatings, DEFAULT_RATING } from "./elo";
import GameAccount from "../models/GameAccount";

type RoomConnections = Map<WebSocket, string>;

const GUEST_ABANDON_TIMEOUT_MS = 5 * 60 * 1000;
const FIRST_MOVE_TIMEOUT_MS = 30 * 1000;
const TOURNAMENT_FIRST_MOVE_TIMEOUT_MS = 60 * 1000;

export interface TournamentGameCallback {
  onGameCompleted(roomId: string): Promise<void>;
}

export class GameService {
  private readonly connections = new Map<string, RoomConnections>();
  private readonly lobbyConnections = new Map<string, Set<WebSocket>>();
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

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const room = this.deriveRoomStatus({
        id: this.generateRoomId(),
        roomType: "tournament",
        status: "waiting",
        state: createInitialGameState(),
        players: [{ ...player1 }, { ...player2 }],
        rematch: null,
        takeback: null,
        seats: this.assignSeats(player1, player2),
        timeControl: tc,
        clockMs,
        lastMoveAt: null,
        firstMoveDeadline,
        ratingBefore: null,
        ratingAfter: null,
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
          players: room.players,
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

    socket.on("close", () => {
      userSockets?.delete(socket);
      if (userSockets?.size === 0) {
        this.lobbyConnections.delete(player.playerId);
        for (const cb of this.lobbyDisconnectCallbacks) {
          try {
            cb(player.playerId);
          } catch {
            /* best-effort */
          }
        }
      }
    });
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

  async createGame(
    creator: PlayerIdentity,
    options: {
      roomType?: MultiplayerRoomType;
      gameSettings?: Partial<GameSettings>;
      timeControl?: TimeControl;
    } = {},
  ): Promise<MultiplayerSnapshot> {
    return this.withLocks([this.playerLockKey(creator.playerId)], async () => {
      const room = await this.createRoomRecord({
        players: [creator],
        roomType: options.roomType ?? "direct",
        assignSeats: false,
        gameSettings: options.gameSettings,
        timeControl: options.timeControl,
      });

      return this.toSnapshot(room);
    });
  }

  async cancelWaitingRoom(gameId: string, player: PlayerIdentity): Promise<void> {
    return this.withLocks([this.roomLockKey(gameId)], async () => {
      const room = await this.getRoom(gameId);

      if (room.status !== "waiting") {
        throw new GameServiceError(409, "GAME_NOT_WAITING", "Only waiting games can be cancelled.");
      }

      if (!room.players.some((p) => p.playerId === player.playerId)) {
        throw new GameServiceError(403, "NOT_IN_GAME", "You are not a player in this game.");
      }

      // Mark as finished so it no longer blocks guest game creation
      await this.saveRoom({
        ...room,
        status: "finished",
        state: { ...room.state, history: [...room.state.history, { type: "draw" }] },
      });
    });
  }

  async joinGame(gameId: string, player: PlayerIdentity): Promise<MultiplayerSnapshot> {
    return this.withLocks(
      [this.roomLockKey(gameId), this.playerLockKey(player.playerId)],
      async () => {
        const room = await this.getRoom(gameId);

        const savedRoom = await this.joinRoom(room, player);
        this.broadcastSnapshot(savedRoom);
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

        if (room.players.length >= 2) {
          return this.toSnapshot(room);
        }

        const savedRoom = await this.joinRoom(room, player);
        this.broadcastSnapshot(savedRoom);
        return this.toSnapshot(savedRoom);
      },
    );
  }

  async getSnapshot(gameId: string): Promise<MultiplayerSnapshot> {
    return this.toSnapshot(await this.getRoom(gameId));
  }

  async listGames(player: PlayerIdentity): Promise<MultiplayerGamesIndex> {
    const rooms = await this.store.listRoomsForPlayer(player.playerId);
    const summaries = rooms.map((room) =>
      this.toSummary(this.deriveRoomStatus(room), player.playerId),
    );

    return {
      active: summaries.filter((game) => game.status !== "finished"),
      finished: summaries.filter((game) => game.status === "finished"),
    };
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
    } else {
      // Refresh the player's identity (profile picture, display name, etc.)
      // so snapshots reflect the latest data from their session.
      this.refreshPlayerIdentity(room, player);
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
        this.broadcastSnapshot(savedRoom);
      });
      return;
    }

    this.broadcastSnapshot(room);
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

    // Auto-revoke rematch request when the requester disconnects from a finished game
    if (
      disconnectedPlayerId &&
      derivedRoom.status === "finished" &&
      derivedRoom.rematch?.requestedBy.length &&
      !this.isPlayerOnline(roomId, disconnectedPlayerId)
    ) {
      const playerColor = getPlayerColorForRoom(derivedRoom, disconnectedPlayerId);
      if (playerColor && derivedRoom.rematch.requestedBy.includes(playerColor)) {
        derivedRoom = await this.saveRoom({ ...derivedRoom, rematch: null });
      }
    }

    this.broadcastSnapshot(derivedRoom);

    // Start abandon timer for guest players who fully disconnect from an active game
    if (
      disconnectedPlayerId &&
      derivedRoom.status === "active" &&
      !this.isPlayerOnline(roomId, disconnectedPlayerId)
    ) {
      const disconnectedPlayer = derivedRoom.players.find(
        (p) => p.playerId === disconnectedPlayerId,
      );
      if (disconnectedPlayer?.kind === "guest") {
        this.startAbandonTimer(roomId, disconnectedPlayerId);
      }
    }
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
          this.broadcastSnapshot(savedRoom);
          return this.toSnapshot(savedRoom);
        }
        case "decline-rematch": {
          const savedRoom = await this.declineRematch(room, playerColor);
          this.broadcastSnapshot(savedRoom);
          return this.toSnapshot(savedRoom);
        }
        case "cancel-rematch": {
          const savedRoom = await this.cancelRematch(room, playerColor);
          this.broadcastSnapshot(savedRoom);
          return this.toSnapshot(savedRoom);
        }
        case "request-takeback": {
          const savedRoom = await this.requestTakeback(room, playerColor);
          this.broadcastSnapshot(savedRoom);
          return this.toSnapshot(savedRoom);
        }
        case "accept-takeback": {
          const savedRoom = await this.acceptTakeback(room, playerColor);
          this.broadcastSnapshot(savedRoom);
          return this.toSnapshot(savedRoom);
        }
        case "decline-takeback": {
          const savedRoom = await this.declineTakeback(room, playerColor);
          this.broadcastSnapshot(savedRoom);
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
            this.broadcastSnapshot(flaggedRoom);
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

      this.broadcastSnapshot(savedRoom);
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
            const room = await this.createRoomRecord({
              players: [opponentEntry.player, player],
              roomType: "matchmaking",
              assignSeats: true,
              timeControl,
            });

            await this.matchmaking.setMatch(opponentEntry.player.playerId, room.id);
            await this.matchmaking.setMatch(player.playerId, room.id);

            return this.toSnapshot(room);
          },
        );

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

  async testForceFinishGame(gameId: string, winner: PlayerColor): Promise<void> {
    if (process.env.NODE_ENV === "production") return;

    return this.withLock(this.roomLockKey(gameId), async () => {
      const room = await this.getRoom(gameId);
      room.state.score[winner] = 10;
      room.status = "finished";
      const savedRoom = await this.saveRoom(room);
      this.broadcastSnapshot(savedRoom);
    });
  }

  pruneInactiveRooms(_maxIdleMs: number): void {
    // Multiplayer history is persisted, so rooms are intentionally retained.
  }

  private async createRoomRecord(options: {
    players: PlayerIdentity[];
    roomType: MultiplayerRoomType;
    assignSeats: boolean;
    timeControl?: TimeControl;
    gameSettings?: Partial<GameSettings>;
  }): Promise<StoredMultiplayerRoom> {
    const tc = options.timeControl ?? null;
    const clockMs = tc ? { white: tc.initialMs, black: tc.initialMs } : null;

    // Set a first-move deadline for timed games that start with both players seated
    const willBeActive = options.assignSeats && options.players.length >= 2;
    const firstMoveDeadline =
      tc && willBeActive ? new Date(Date.now() + FIRST_MOVE_TIMEOUT_MS) : null;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const room = this.deriveRoomStatus({
        id: this.generateRoomId(),
        roomType: options.roomType,
        status: "waiting",
        state: createInitialGameState(options.gameSettings),
        players: options.players.map((player) => ({ ...player })),
        rematch: null,
        takeback: null,
        seats: options.assignSeats
          ? this.assignSeats(options.players[0], options.players[1])
          : {
              white: null,
              black: null,
            },
        timeControl: tc,
        clockMs,
        lastMoveAt: null,
        firstMoveDeadline,
        ratingBefore: null,
        ratingAfter: null,
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
          players: room.players,
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
    firstPlayer: PlayerIdentity,
    secondPlayer: PlayerIdentity,
  ): MultiplayerSeatAssignments {
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

    if (room.players.length >= 2) {
      throw new GameServiceError(409, "ROOM_FULL", "That game already has two players.");
    }

    const players = [...room.players, player];
    const seats =
      players.length === 2 && !room.seats.white && !room.seats.black
        ? this.assignSeats(players[0], players[1])
        : room.seats;

    return this.saveRoom({
      ...room,
      players,
      seats,
    });
  }

  private isPlayerInRoom(room: StoredMultiplayerRoom, playerId: string): boolean {
    return room.players.some((player) => player.playerId === playerId);
  }

  /** Update a player's mutable identity fields (display name, profile picture)
   *  in the room's players array and seat assignments so snapshots stay fresh. */
  private refreshPlayerIdentity(room: StoredMultiplayerRoom, fresh: PlayerIdentity): void {
    for (let i = 0; i < room.players.length; i++) {
      if (room.players[i].playerId === fresh.playerId) {
        room.players[i] = {
          ...room.players[i],
          displayName: fresh.displayName,
          profilePicture: fresh.profilePicture,
        };
      }
    }
    for (const color of ["white", "black"] as const) {
      const seat = room.seats[color];
      if (seat?.playerId === fresh.playerId) {
        room.seats[color] = {
          ...seat,
          displayName: fresh.displayName,
          profilePicture: fresh.profilePicture,
        };
      }
    }
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

    // Update Elo ratings when a matchmaking game finishes
    if (
      saved.status === "finished" &&
      previousStatus !== "finished" &&
      saved.roomType === "matchmaking"
    ) {
      void this.updateEloRatings(saved).catch((err) => {
        console.error("[game] Elo update failed for room", saved.id, err);
      });
    }

    return saved;
  }

  private async updateEloRatings(room: StoredMultiplayerRoom): Promise<void> {
    const whitePlayer = room.seats.white;
    const blackPlayer = room.seats.black;

    // Only rate games where both players are accounts
    if (
      !whitePlayer ||
      !blackPlayer ||
      whitePlayer.kind !== "account" ||
      blackPlayer.kind !== "account"
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
    await this.store.saveRoom(room);

    console.log(
      `[game] Elo updated for room ${room.id}: white ${whiteElo}->${newRatingA}, black ${blackElo}->${newRatingB}`,
    );
  }

  private deriveRoomStatus(room: StoredMultiplayerRoom): StoredMultiplayerRoom {
    const players = this.normalizePlayers(room.players, room.seats);
    const seats =
      players.length < 2
        ? {
            white: null,
            black: null,
          }
        : {
            white:
              room.seats.white &&
              players.some((player) => player.playerId === room.seats.white?.playerId)
                ? { ...room.seats.white }
                : null,
            black:
              room.seats.black &&
              players.some((player) => player.playerId === room.seats.black?.playerId)
                ? { ...room.seats.black }
                : null,
          };
    const status = this.getStatus(room.state, players, seats);
    const rematch = status === "finished" ? this.normalizeRematch(room.rematch, seats) : null;

    // Clear takeback state if game is not active
    const takeback = status === "active" ? (room.takeback ?? null) : null;

    return {
      ...room,
      roomType: room.roomType ?? "direct",
      players,
      rematch,
      takeback,
      seats,
      status,
    };
  }

  private normalizeRematch(
    rematch: MultiplayerRematchState | null,
    seats: MultiplayerSeatAssignments,
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

  private normalizePlayers(
    players: PlayerIdentity[] | undefined,
    seats: MultiplayerSeatAssignments,
  ): PlayerIdentity[] {
    const nextPlayers: PlayerIdentity[] = [];
    const seen = new Set<string>();

    for (const player of players ?? []) {
      if (seen.has(player.playerId)) {
        continue;
      }

      seen.add(player.playerId);
      nextPlayers.push({ ...player });
    }

    for (const color of ["white", "black"] as PlayerColor[]) {
      const player = seats[color];
      if (!player || seen.has(player.playerId)) {
        continue;
      }

      seen.add(player.playerId);
      nextPlayers.push({ ...player });
    }

    return nextPlayers;
  }

  private getStatus(
    state: StoredMultiplayerRoom["state"],
    players: PlayerIdentity[],
    seats: MultiplayerSeatAssignments,
  ): MultiplayerStatus {
    if (isGameOver(state)) {
      return "finished";
    }

    if (players.length >= 2 && seats.white && seats.black) {
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

  private toSeatSlot(room: StoredMultiplayerRoom, color: PlayerColor): PlayerSlot | null {
    const player = room.seats[color];
    if (!player) {
      return null;
    }

    return this.toPlayerSlot(room.id, player);
  }

  private toSnapshot(room: StoredMultiplayerRoom): MultiplayerSnapshot {
    const roomSpectators = this.spectatorIdentities.get(room.id);
    const spectators: PlayerSlot[] = roomSpectators
      ? Array.from(roomSpectators.values()).map((identity) => this.toPlayerSlot(room.id, identity))
      : [];

    return {
      gameId: room.id,
      roomType: room.roomType,
      status: room.status,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      state: room.state,
      players: room.players.map((player) => this.toPlayerSlot(room.id, player)),
      spectators,
      rematch: room.rematch,
      takeback: room.takeback,
      seats: {
        white: this.toSeatSlot(room, "white"),
        black: this.toSeatSlot(room, "black"),
      },
      timeControl: room.timeControl,
      clock: this.computeLiveClock(room),
      firstMoveDeadline: room.firstMoveDeadline?.toISOString() ?? null,
      tournamentId: room.tournamentId ?? null,
      tournamentReady:
        room.roomType === "tournament"
          ? !!(room.firstMoveDeadline || room.lastMoveAt) || !room.timeControl
          : undefined,
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

  private toSummary(room: StoredMultiplayerRoom, playerId: string): MultiplayerGameSummary {
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
      players: room.players.map((player) => this.toPlayerSlot(room.id, player)),
      seats: {
        white: this.toSeatSlot(room, "white"),
        black: this.toSeatSlot(room, "black"),
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

    const requestedBy = Array.from(new Set([...(room.rematch?.requestedBy ?? []), playerColor]));

    if (requestedBy.length === 2) {
      // Both players agreed — create a new game room
      const whitePlayer = room.seats.white;
      const blackPlayer = room.seats.black;
      const newRoom = await this.createRoomRecord({
        players: [whitePlayer, blackPlayer],
        roomType: room.roomType,
        assignSeats: true,
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
      for (const player of room.players) {
        this.broadcastLobby(player.playerId, {
          type: "game-update",
          summary: this.toSummary(newRoom, player.playerId),
        });
      }

      // Mark old room rematch as null (completed)
      await this.saveRoom({
        ...room,
        rematch: null,
        takeback: null,
      });

      return newRoom;
    }

    return this.saveRoom({
      ...room,
      rematch: {
        requestedBy,
      },
    });
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

    return this.saveRoom({
      ...room,
      rematch: null,
    });
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

    return this.saveRoom({
      ...room,
      rematch: null,
    });
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

  private broadcastSnapshot(room: StoredMultiplayerRoom): void {
    const snapshot = this.toSnapshot(room);
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

    // Also notify lobby for participants
    for (const player of room.players) {
      this.broadcastLobby(player.playerId, {
        type: "game-update",
        summary: this.toSummary(room, player.playerId),
      });
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
        this.broadcastSnapshot(savedRoom);
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

          this.broadcastSnapshot(savedRoom);
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
      this.broadcastSnapshot(savedRoom);

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
