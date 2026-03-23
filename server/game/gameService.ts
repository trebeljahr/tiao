import WebSocket from "ws";
import {
  ClientToServerMessage,
  MultiplayerGameSummary,
  MultiplayerGamesIndex,
  MultiplayerSeatAssignments,
  MultiplayerSnapshot,
  MultiplayerStatus,
  PlayerColor,
  PlayerIdentity,
  PlayerSlot,
  confirmPendingJump,
  createInitialGameState,
  getWinner,
  isGameOver,
  jumpPiece,
  placePiece,
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

export class GameService {
  private readonly connections = new Map<string, RoomConnections>();
  private readonly socketRooms = new Map<WebSocket, string>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly store: GameRoomStore = new MongoGameRoomStore()) {}

  async createGame(creator: PlayerIdentity): Promise<MultiplayerSnapshot> {
    return this.withLocks([this.playerLockKey(creator.playerId)], async () => {
      await this.ensureGuestPlayerHasSingleOpenGame(creator);

      for (let attempt = 0; attempt < 12; attempt += 1) {
        const room = this.deriveRoomStatus({
          id: this.generateRoomId(),
          status: "waiting",
          state: createInitialGameState(),
          seats: {
            white: creator,
            black: null,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        try {
          const savedRoom = await this.store.createRoom({
            id: room.id,
            status: room.status,
            state: room.state,
            seats: room.seats,
          });

          return this.toSnapshot(savedRoom);
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
        const existingSeat = getPlayerColorForRoom(room, player.playerId);

        await this.ensureGuestPlayerHasSingleOpenGame(player, room.id);

        if (!existingSeat) {
          if (!room.seats.white) {
            room.seats.white = player;
          } else if (!room.seats.black) {
            room.seats.black = player;
          } else {
            throw new GameServiceError(
              409,
              "ROOM_FULL",
              "That game already has two players."
            );
          }
        }

        const savedRoom = existingSeat
          ? room
          : await this.saveRoom({
              ...room,
              seats: {
                white: room.seats.white,
                black: room.seats.black,
              },
            });

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

  async resetGame(
    gameId: string,
    player: PlayerIdentity
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

      if (!isGameOver(room.state)) {
        throw new GameServiceError(
          409,
          "GAME_NOT_FINISHED",
          "You can only restart the board once the game is over."
        );
      }

      const savedRoom = await this.saveRoom({
        ...room,
        state: createInitialGameState(),
      });

      this.broadcastSnapshot(savedRoom);
      return this.toSnapshot(savedRoom);
    });
  }

  async connect(
    gameId: string,
    player: PlayerIdentity,
    socket: WebSocket
  ): Promise<void> {
    const room = await this.getRoom(gameId);
    if (!getPlayerColorForRoom(room, player.playerId)) {
      throw new GameServiceError(
        403,
        "NOT_IN_GAME",
        "Join the game before opening a multiplayer connection."
      );
    }

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

    connections.delete(socket);
    if (connections.size === 0) {
      this.connections.delete(roomId);
      return;
    }

    const room = await this.store.getRoom(roomId);
    if (room) {
      this.broadcastSnapshot(room);
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

      let result;
      switch (message.type) {
        case "place-piece":
          result = placePiece(room.state, message.position);
          break;
        case "jump-piece":
          result = jumpPiece(room.state, message.from, message.to);
          break;
        case "confirm-jump":
          result = confirmPendingJump(room.state);
          break;
        case "undo-pending-jump-step":
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

      const savedRoom = await this.saveRoom({
        ...room,
        state: result.value,
      });

      this.broadcastSnapshot(savedRoom);
      return this.toSnapshot(savedRoom);
    });
  }

  pruneInactiveRooms(_maxIdleMs: number): void {
    // Multiplayer history is persisted, so rooms are intentionally retained.
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
    return {
      ...room,
      status: this.getStatus(room),
    };
  }

  private getStatus(room: {
    state: StoredMultiplayerRoom["state"];
    seats: MultiplayerSeatAssignments;
  }): MultiplayerStatus {
    if (isGameOver(room.state)) {
      return "finished";
    }

    if (room.seats.white && room.seats.black) {
      return "active";
    }

    return "waiting";
  }

  private toSlot(
    room: StoredMultiplayerRoom,
    color: PlayerColor
  ): PlayerSlot | null {
    const player = room.seats[color];
    if (!player) {
      return null;
    }

    return {
      player,
      online: Array.from(this.getConnections(room.id).values()).includes(
        player.playerId
      ),
    };
  }

  private toSnapshot(room: StoredMultiplayerRoom): MultiplayerSnapshot {
    return {
      gameId: room.id,
      status: room.status,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      state: room.state,
      seats: {
        white: this.toSlot(room, "white"),
        black: this.toSlot(room, "black"),
      },
    };
  }

  private toSummary(
    room: StoredMultiplayerRoom,
    playerId: string
  ): MultiplayerGameSummary {
    return {
      gameId: room.id,
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
      seats: {
        white: this.toSlot(room, "white"),
        black: this.toSlot(room, "black"),
      },
    };
  }

  private broadcastSnapshot(room: StoredMultiplayerRoom): void {
    const connections = this.connections.get(room.id);
    if (!connections || connections.size === 0) {
      return;
    }

    const snapshot = this.toSnapshot(room);
    const message = JSON.stringify({
      type: "snapshot",
      snapshot,
    });

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
