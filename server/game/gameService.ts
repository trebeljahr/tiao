import WebSocket from "ws";
import {
  ClientToServerMessage,
  MatchmakingState,
  MultiplayerGameSummary,
  MultiplayerGamesIndex,
  MultiplayerRematchState,
  MultiplayerTakebackState,
  MultiplayerRoomType,
  MultiplayerSeatAssignments,
  MultiplayerSnapshot,
  MultiplayerStatus,
  PlayerColor,
  PlayerIdentity,
  PlayerSlot,
  TimeControl,
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

type RoomConnections = Map<WebSocket, string>;
type MatchmakingQueueEntry = {
  player: PlayerIdentity;
  queuedAt: number;
  timeControl: TimeControl;
};

const GUEST_ABANDON_TIMEOUT_MS = 5 * 60 * 1000;

export class GameService {
  private readonly connections = new Map<string, RoomConnections>();
  private readonly lobbyConnections = new Map<string, Set<WebSocket>>();
  private readonly socketRooms = new Map<WebSocket, string>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly matchmakingQueue: MatchmakingQueueEntry[] = [];
  private readonly matchmakingMatches = new Map<string, string>();
  private readonly guestAbandonTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly clockTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly store: GameRoomStore = new MongoGameRoomStore(),
    private readonly seatRandom: () => number = Math.random,
    private readonly abandonTimeoutMs: number = GUEST_ABANDON_TIMEOUT_MS
  ) {}

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
      }
    });
  }

  private broadcastLobby(playerId: string, payload: any): void {
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
    options: { roomType?: MultiplayerRoomType } = {}
  ): Promise<MultiplayerSnapshot> {
    return this.withLocks([this.playerLockKey(creator.playerId)], async () => {
      await this.ensureGuestPlayerHasSingleOpenGame(creator);

      const room = await this.createRoomRecord({
        players: [creator],
        roomType: options.roomType ?? "direct",
        assignSeats: false,
      });

      return this.toSnapshot(room);
    });
  }

  async joinGame(
    gameId: string,
    player: PlayerIdentity
  ): Promise<MultiplayerSnapshot> {
    return this.withLocks(
      [this.roomLockKey(gameId), this.playerLockKey(player.playerId)],
      async () => {
        const room = await this.getRoom(gameId);
        await this.ensureGuestPlayerHasSingleOpenGame(player, room.id);

        const savedRoom = await this.joinRoom(room, player);
        this.broadcastSnapshot(savedRoom);
        return this.toSnapshot(savedRoom);
      }
    );
  }

  async accessGame(
    gameId: string,
    player: PlayerIdentity
  ): Promise<MultiplayerSnapshot> {
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

        await this.ensureGuestPlayerHasSingleOpenGame(player, room.id);
        const savedRoom = await this.joinRoom(room, player);
        this.broadcastSnapshot(savedRoom);
        return this.toSnapshot(savedRoom);
      }
    );
  }

  async getSnapshot(gameId: string): Promise<MultiplayerSnapshot> {
    return this.toSnapshot(await this.getRoom(gameId));
  }

  async listGames(player: PlayerIdentity): Promise<MultiplayerGamesIndex> {
    if (player.kind !== "account") {
      throw new GameServiceError(
        403,
        "ACCOUNT_REQUIRED",
        "Sign in to browse ongoing games and match history."
      );
    }

    const rooms = await this.store.listRoomsForPlayer(player.playerId);
    const summaries = rooms.map((room) =>
      this.toSummary(this.deriveRoomStatus(room), player.playerId)
    );

    return {
      active: summaries.filter((game) => game.status !== "finished"),
      finished: summaries.filter((game) => game.status === "finished"),
    };
  }

  async connect(
    gameId: string,
    player: PlayerIdentity,
    socket: WebSocket
  ): Promise<void> {
    const room = await this.getRoom(gameId);

    this.clearAbandonTimer(room.id, player.playerId);

    const connections = this.getConnections(room.id);
    connections.set(socket, player.playerId);
    this.socketRooms.set(socket, room.id);
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
        (p) => p.playerId === disconnectedPlayerId
      );
      if (disconnectedPlayer?.kind === "guest") {
        this.startAbandonTimer(roomId, disconnectedPlayerId);
      }
    }
  }

  async applyAction(
    gameId: string,
    player: PlayerIdentity,
    message: ClientToServerMessage
  ): Promise<MultiplayerSnapshot> {
    return this.withLock(this.roomLockKey(gameId), async () => {
      const room = await this.getRoom(gameId);
      const playerColor = getPlayerColorForRoom(room, player.playerId);

      if (!playerColor) {
        throw new GameServiceError(
          403,
          "NOT_IN_GAME",
          "You are not seated in this game."
        );
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
              "You can only forfeit an active game."
            );
          }
          result = forfeitGame(room.state, playerColor);
          break;
        }
        case "place-piece":
          this.ensureActionableRoom(room, playerColor);
          result = placePiece(room.state, message.position);
          break;
        case "jump-piece":
          this.ensureActionableRoom(room, playerColor);
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
          throw new GameServiceError(
            400,
            "UNKNOWN_ACTION",
            "That message type is not supported."
          );
      }

      if (!result.ok) {
        throw new GameServiceError(409, result.code, result.reason);
      }

      // Clock logic: deduct elapsed time and add increment on turn change
      let clockMs = room.clockMs ? { ...room.clockMs } : null;
      let lastMoveAt = room.lastMoveAt;

      if (clockMs && room.timeControl && room.status === "active" && lastMoveAt) {
        const now = new Date();
        const elapsed = now.getTime() - lastMoveAt.getTime();
        const movingColor = room.state.currentTurn;

        clockMs[movingColor] = Math.max(0, clockMs[movingColor] - elapsed);

        // Check for time expiry
        if (clockMs[movingColor] <= 0) {
          const flagResult = forfeitGame(room.state, movingColor);
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
      }

      // Clear any pending takeback when a game action is made
      const savedRoom = await this.saveRoom({
        ...room,
        state: result.value,
        takeback: null,
        clockMs,
        lastMoveAt,
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
      this.matchmakingMatches.delete(player.playerId);

      const existingEntry = this.matchmakingQueue.find(
        (entry) => entry.player.playerId === player.playerId
      );
      if (existingEntry) {
        return {
          status: "searching",
          queuedAt: new Date(existingEntry.queuedAt).toISOString(),
          timeControl: existingEntry.timeControl,
        };
      }

      await this.ensureGuestPlayerHasSingleOpenGame(player);

      // Find a matching opponent with the same time control
      const matchIndex = this.matchmakingQueue.findIndex(
        (entry) =>
          entry.player.playerId !== player.playerId &&
          this.timeControlsMatch(entry.timeControl, timeControl),
      );

      if (matchIndex >= 0) {
        const opponentEntry = this.matchmakingQueue.splice(matchIndex, 1)[0];

        const snapshot = await this.withLocks(
          [
            this.playerLockKey(player.playerId),
            this.playerLockKey(opponentEntry.player.playerId),
          ],
          async () => {
            await this.ensureGuestPlayerHasSingleOpenGame(player);
            await this.ensureGuestPlayerHasSingleOpenGame(opponentEntry.player);

            const room = await this.createRoomRecord({
              players: [opponentEntry.player, player],
              roomType: "matchmaking",
              assignSeats: true,
              timeControl,
            });

            this.matchmakingMatches.set(opponentEntry.player.playerId, room.id);
            this.matchmakingMatches.set(player.playerId, room.id);

            return this.toSnapshot(room);
          }
        );

        return {
          status: "matched",
          snapshot,
        };
      }

      const queuedAt = Date.now();
      this.matchmakingQueue.push({
        player,
        queuedAt,
        timeControl,
      });

      return {
        status: "searching",
        queuedAt: new Date(queuedAt).toISOString(),
        timeControl,
      };
    });
  }

  private timeControlsMatch(a: TimeControl, b: TimeControl): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.initialMs === b.initialMs && a.incrementMs === b.incrementMs;
  }

  async getMatchmakingState(player: PlayerIdentity): Promise<MatchmakingState> {
    return this.withLock(this.matchmakingLockKey(), async () => {
      const matchedGameId = this.matchmakingMatches.get(player.playerId);
      if (matchedGameId) {
        return {
          status: "matched",
          snapshot: await this.getSnapshot(matchedGameId),
        };
      }

      const existingEntry = this.matchmakingQueue.find(
        (entry) => entry.player.playerId === player.playerId
      );
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
      const queueIndex = this.matchmakingQueue.findIndex(
        (entry) => entry.player.playerId === player.playerId
      );

      if (queueIndex >= 0) {
        this.matchmakingQueue.splice(queueIndex, 1);
      }

      this.matchmakingMatches.delete(player.playerId);
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
  }): Promise<StoredMultiplayerRoom> {
    const tc = options.timeControl ?? null;
    const clockMs = tc ? { white: tc.initialMs, black: tc.initialMs } : null;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const room = this.deriveRoomStatus({
        id: this.generateRoomId(),
        roomType: options.roomType,
        status: "waiting",
        state: createInitialGameState(),
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
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      try {
        return await this.store.createRoom({
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
        });
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
      "Unable to create a multiplayer room right now."
    );
  }

  private assignSeats(
    firstPlayer: PlayerIdentity,
    secondPlayer: PlayerIdentity
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
    player: PlayerIdentity
  ): Promise<StoredMultiplayerRoom> {
    if (this.isPlayerInRoom(room, player.playerId)) {
      return room;
    }

    if (room.players.length >= 2) {
      throw new GameServiceError(
        409,
        "ROOM_FULL",
        "That game already has two players."
      );
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

  private async getRoom(gameId: string): Promise<StoredMultiplayerRoom> {
    const room = await this.store.getRoom(gameId);

    if (!room) {
      throw new GameServiceError(404, "ROOM_NOT_FOUND", "Game not found.");
    }

    return this.deriveRoomStatus(room);
  }

  private async saveRoom(
    room: StoredMultiplayerRoom
  ): Promise<StoredMultiplayerRoom> {
    return this.deriveRoomStatus(await this.store.saveRoom(this.deriveRoomStatus(room)));
  }

  private async ensureGuestPlayerHasSingleOpenGame(
    player: PlayerIdentity,
    allowedRoomId?: string
  ): Promise<void> {
    if (player.kind !== "guest") {
      return;
    }

    const unfinishedRoom = await this.store.findUnfinishedRoomByPlayer(
      player.playerId
    );

    if (unfinishedRoom && unfinishedRoom.id !== allowedRoomId) {
      throw new GameServiceError(
        409,
        "GUEST_ACTIVE_GAME_LIMIT",
        "Guest players can only keep one unfinished multiplayer game at a time. Sign in to juggle multiple tables and unlock match history."
      );
    }
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
              players.some(
                (player) => player.playerId === room.seats.white?.playerId
              )
                ? { ...room.seats.white }
                : null,
            black:
              room.seats.black &&
              players.some(
                (player) => player.playerId === room.seats.black?.playerId
              )
                ? { ...room.seats.black }
                : null,
          };
    const status = this.getStatus(room.state, players, seats);
    const rematch =
      status === "finished" ? this.normalizeRematch(room.rematch, seats) : null;

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
    seats: MultiplayerSeatAssignments
  ): MultiplayerRematchState | null {
    if (!rematch) {
      return null;
    }

    const activeColors = (["white", "black"] as PlayerColor[]).filter(
      (color) => !!seats[color]
    );
    const requestedBy = rematch.requestedBy.filter((color) =>
      activeColors.includes(color)
    );

    if (requestedBy.length === 0) {
      return null;
    }

    return {
      requestedBy,
    };
  }

  private normalizePlayers(
    players: PlayerIdentity[] | undefined,
    seats: MultiplayerSeatAssignments
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
    seats: MultiplayerSeatAssignments
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

  private toPlayerSlot(roomId: string, player: PlayerIdentity): PlayerSlot {
    return {
      player,
      online: this.isPlayerOnline(roomId, player.playerId),
    };
  }

  private toSeatSlot(
    room: StoredMultiplayerRoom,
    color: PlayerColor
  ): PlayerSlot | null {
    const player = room.seats[color];
    if (!player) {
      return null;
    }

    return this.toPlayerSlot(room.id, player);
  }

  private toSnapshot(room: StoredMultiplayerRoom): MultiplayerSnapshot {
    return {
      gameId: room.id,
      roomType: room.roomType,
      status: room.status,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      state: room.state,
      players: room.players.map((player) => this.toPlayerSlot(room.id, player)),
      rematch: room.rematch,
      takeback: room.takeback,
      seats: {
        white: this.toSeatSlot(room, "white"),
        black: this.toSeatSlot(room, "black"),
      },
      timeControl: room.timeControl,
      clock: this.computeLiveClock(room),
    };
  }

  /** Compute live remaining times by subtracting elapsed since lastMoveAt. */
  private computeLiveClock(
    room: StoredMultiplayerRoom,
  ): { white: number; black: number; lastMoveAt: string } | null {
    if (!room.clockMs || !room.timeControl) return null;

    const white = room.clockMs.white;
    const black = room.clockMs.black;
    const lastMoveAt = room.lastMoveAt ?? room.createdAt;

    // If game is active, deduct elapsed time from the current player
    if (room.status === "active" && room.lastMoveAt) {
      const elapsed = Date.now() - room.lastMoveAt.getTime();
      const current = room.state.currentTurn;
      return {
        white: current === "white" ? Math.max(0, white - elapsed) : white,
        black: current === "black" ? Math.max(0, black - elapsed) : black,
        lastMoveAt: lastMoveAt.toISOString(),
      };
    }

    return {
      white,
      black,
      lastMoveAt: lastMoveAt.toISOString(),
    };
  }

  private toSummary(
    room: StoredMultiplayerRoom,
    playerId: string
  ): MultiplayerGameSummary {
    return {
      gameId: room.id,
      roomType: room.roomType,
      status: room.status,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      currentTurn: room.state.currentTurn,
      historyLength: room.state.history.length,
      winner: getWinner(room.state),
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
    };
  }

  private ensureActionableRoom(
    room: StoredMultiplayerRoom,
    playerColor: PlayerColor
  ): void {
    if (!room.seats.white || !room.seats.black) {
      throw new GameServiceError(
        409,
        "WAITING_FOR_OPPONENT",
        "The game cannot start until both players have joined."
      );
    }

    if (room.state.currentTurn !== playerColor) {
      throw new GameServiceError(
        409,
        "NOT_YOUR_TURN",
        "It is not your turn."
      );
    }
  }

  private async requestRematch(
    room: StoredMultiplayerRoom,
    playerColor: PlayerColor
  ): Promise<StoredMultiplayerRoom> {
    if (room.status !== "finished") {
      throw new GameServiceError(
        409,
        "GAME_NOT_FINISHED",
        "A rematch is only available once the game has finished."
      );
    }

    if (!room.seats.white || !room.seats.black) {
      throw new GameServiceError(
        409,
        "WAITING_FOR_OPPONENT",
        "A rematch needs both players to still be seated."
      );
    }

    const requestedBy = Array.from(
      new Set([...(room.rematch?.requestedBy ?? []), playerColor])
    );

    if (requestedBy.length === 2) {
      // Both players agreed — create a new game room
      const whitePlayer = room.seats.white;
      const blackPlayer = room.seats.black;
      const newRoom = await this.createRoomRecord({
        players: [whitePlayer, blackPlayer],
        roomType: room.roomType,
        assignSeats: true,
        timeControl: room.timeControl ?? undefined,
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
    playerColor: PlayerColor
  ): Promise<StoredMultiplayerRoom> {
    if (room.status !== "finished") {
      throw new GameServiceError(
        409,
        "GAME_NOT_FINISHED",
        "A rematch can only be declined once the game has finished."
      );
    }

    const incomingRequestExists = (room.rematch?.requestedBy ?? []).some(
      (color) => color !== playerColor
    );

    if (!incomingRequestExists) {
      throw new GameServiceError(
        409,
        "NO_REMATCH_REQUEST",
        "There is no incoming rematch request to decline."
      );
    }

    return this.saveRoom({
      ...room,
      rematch: null,
    });
  }

  private async cancelRematch(
    room: StoredMultiplayerRoom,
    playerColor: PlayerColor
  ): Promise<StoredMultiplayerRoom> {
    if (room.status !== "finished") {
      throw new GameServiceError(
        409,
        "GAME_NOT_FINISHED",
        "Cannot cancel a rematch on a game that is not finished."
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
    playerColor: PlayerColor
  ): Promise<StoredMultiplayerRoom> {
    if (room.status !== "active") {
      throw new GameServiceError(
        409,
        "GAME_NOT_ACTIVE",
        "Takebacks are only available during an active game."
      );
    }

    if (room.state.history.length === 0) {
      throw new GameServiceError(
        409,
        "NO_MOVES",
        "There are no moves to take back."
      );
    }

    if (room.takeback?.requestedBy) {
      throw new GameServiceError(
        409,
        "TAKEBACK_PENDING",
        "A takeback request is already pending."
      );
    }

    const declinedCount = room.takeback?.declinedCount ?? { white: 0, black: 0 };
    if (declinedCount[playerColor] >= 3) {
      throw new GameServiceError(
        409,
        "TAKEBACK_LIMIT",
        "You have used all your takeback requests. Make a move to reset."
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
    playerColor: PlayerColor
  ): Promise<StoredMultiplayerRoom> {
    if (!room.takeback?.requestedBy) {
      throw new GameServiceError(
        409,
        "NO_TAKEBACK_REQUEST",
        "There is no takeback request to accept."
      );
    }

    if (room.takeback.requestedBy === playerColor) {
      throw new GameServiceError(
        409,
        "OWN_TAKEBACK",
        "You cannot accept your own takeback request."
      );
    }

    // Undo the last move by the requester.
    // If it's currently the requester's turn, undo their opponent's last move
    // then undo the requester's move. If it's the opponent's turn, just undo
    // the requester's last move.
    let state = room.state;
    const requester = room.takeback.requestedBy;

    if (state.currentTurn !== requester && state.history.length > 0) {
      // It's the accepting player's turn, meaning the requester's move was
      // the one before. Just undo the last move.
      const undo = undoLastTurn(state);
      if (!undo.ok) {
        throw new GameServiceError(409, undo.code, undo.reason);
      }
      state = undo.value;
    } else if (state.currentTurn === requester && state.history.length >= 2) {
      // It's the requester's turn, so undo the accepting player's move first,
      // then undo the requester's previous move.
      const undo1 = undoLastTurn(state);
      if (!undo1.ok) {
        throw new GameServiceError(409, undo1.code, undo1.reason);
      }
      const undo2 = undoLastTurn(undo1.value);
      if (!undo2.ok) {
        throw new GameServiceError(409, undo2.code, undo2.reason);
      }
      state = undo2.value;
    }

    return this.saveRoom({
      ...room,
      state,
      takeback: null,
    });
  }

  private async declineTakeback(
    room: StoredMultiplayerRoom,
    playerColor: PlayerColor
  ): Promise<StoredMultiplayerRoom> {
    if (!room.takeback?.requestedBy) {
      throw new GameServiceError(
        409,
        "NO_TAKEBACK_REQUEST",
        "There is no takeback request to decline."
      );
    }

    if (room.takeback.requestedBy === playerColor) {
      throw new GameServiceError(
        409,
        "OWN_TAKEBACK",
        "You cannot decline your own takeback request."
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
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    );
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

        const opponentColor = playerColor === "white" ? "black" : "white";
        derived.state.score[opponentColor] = 10;
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
          const flagResult = forfeitGame(freshRoom.state, flagColor);
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

  private matchmakingLockKey(): string {
    return "matchmaking";
  }

  private playerLockKey(playerId: string): string {
    return `player:${playerId}`;
  }

  private roomLockKey(gameId: string): string {
    return `room:${gameId.trim().toUpperCase()}`;
  }

  private async withLocks<T>(
    keys: string[],
    operation: () => Promise<T>
  ): Promise<T> {
    const uniqueKeys = Array.from(new Set(keys)).sort();

    async function run(
      service: GameService,
      index: number
    ): Promise<T> {
      if (index >= uniqueKeys.length) {
        return operation();
      }

      return service.withLock(uniqueKeys[index], () => run(service, index + 1));
    }

    return run(this, 0);
  }

  private async withLock<T>(
    key: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.locks.set(key, current);
    await previous.catch(() => undefined);

    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === current) {
        this.locks.delete(key);
      }
    }
  }
}

export const gameService = new GameService();
