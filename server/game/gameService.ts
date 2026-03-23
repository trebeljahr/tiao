import WebSocket from "ws";
import {
  ClientToServerMessage,
  GameState,
  MultiplayerSnapshot,
  MultiplayerStatus,
  PlayerColor,
  PlayerIdentity,
  PlayerSlot,
  cloneGameState,
  confirmPendingJump,
  createInitialGameState,
  isGameOver,
  jumpPiece,
  placePiece,
  undoPendingJumpStep,
} from "../../shared/src";

type Room = {
  id: string;
  state: GameState;
  seats: Record<PlayerColor, PlayerIdentity | null>;
  connections: Map<WebSocket, string>;
  createdAt: Date;
  updatedAt: Date;
};

export class GameServiceError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class GameService {
  private rooms = new Map<string, Room>();

  createGame(creator: PlayerIdentity): MultiplayerSnapshot {
    const id = this.generateRoomId();
    const now = new Date();

    const room: Room = {
      id,
      state: createInitialGameState(),
      seats: {
        white: creator,
        black: null,
      },
      connections: new Map(),
      createdAt: now,
      updatedAt: now,
    };

    this.rooms.set(id, room);
    return this.toSnapshot(room);
  }

  joinGame(gameId: string, player: PlayerIdentity): MultiplayerSnapshot {
    const room = this.getRoom(gameId);
    const existingSeat = this.getPlayerColor(room, player.playerId);

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

    room.updatedAt = new Date();
    this.broadcastSnapshot(room);

    return this.toSnapshot(room);
  }

  getSnapshot(gameId: string): MultiplayerSnapshot {
    return this.toSnapshot(this.getRoom(gameId));
  }

  resetGame(gameId: string, player: PlayerIdentity): MultiplayerSnapshot {
    const room = this.getRoom(gameId);
    const playerColor = this.getPlayerColor(room, player.playerId);

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

    room.state = createInitialGameState();
    room.updatedAt = new Date();
    this.broadcastSnapshot(room);

    return this.toSnapshot(room);
  }

  connect(gameId: string, player: PlayerIdentity, socket: WebSocket): void {
    const room = this.getRoom(gameId);
    if (!this.getPlayerColor(room, player.playerId)) {
      throw new GameServiceError(
        403,
        "NOT_IN_GAME",
        "Join the game before opening a multiplayer connection."
      );
    }

    room.connections.set(socket, player.playerId);
    room.updatedAt = new Date();
    this.broadcastSnapshot(room);
  }

  disconnect(socket: WebSocket): void {
    for (const room of this.rooms.values()) {
      if (!room.connections.has(socket)) {
        continue;
      }

      room.connections.delete(socket);
      room.updatedAt = new Date();
      this.broadcastSnapshot(room);
      return;
    }
  }

  applyAction(
    gameId: string,
    player: PlayerIdentity,
    message: ClientToServerMessage
  ): MultiplayerSnapshot {
    const room = this.getRoom(gameId);
    const playerColor = this.getPlayerColor(room, player.playerId);

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

    room.state = result.value;
    room.updatedAt = new Date();
    this.broadcastSnapshot(room);

    return this.toSnapshot(room);
  }

  pruneInactiveRooms(maxIdleMs: number): void {
    const now = Date.now();

    for (const [roomId, room] of this.rooms.entries()) {
      if (room.connections.size > 0) {
        continue;
      }

      if (now - room.updatedAt.getTime() > maxIdleMs) {
        this.rooms.delete(roomId);
      }
    }
  }

  private getRoom(gameId: string): Room {
    const normalizedId = gameId.trim().toUpperCase();
    const room = this.rooms.get(normalizedId);

    if (!room) {
      throw new GameServiceError(404, "ROOM_NOT_FOUND", "Game not found.");
    }

    return room;
  }

  private generateRoomId(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let roomId = "";

    do {
      roomId = Array.from({ length: 6 }, () => {
        const index = Math.floor(Math.random() * alphabet.length);
        return alphabet[index];
      }).join("");
    } while (this.rooms.has(roomId));

    return roomId;
  }

  private getPlayerColor(
    room: Room,
    playerId: string
  ): PlayerColor | null {
    if (room.seats.white?.playerId === playerId) {
      return "white";
    }

    if (room.seats.black?.playerId === playerId) {
      return "black";
    }

    return null;
  }

  private getStatus(room: Room): MultiplayerStatus {
    if (isGameOver(room.state)) {
      return "finished";
    }

    if (room.seats.white && room.seats.black) {
      return "active";
    }

    return "waiting";
  }

  private toSlot(room: Room, color: PlayerColor): PlayerSlot | null {
    const player = room.seats[color];
    if (!player) {
      return null;
    }

    return {
      player,
      online: Array.from(room.connections.values()).includes(player.playerId),
    };
  }

  private toSnapshot(room: Room): MultiplayerSnapshot {
    return {
      gameId: room.id,
      status: this.getStatus(room),
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      state: cloneGameState(room.state),
      seats: {
        white: this.toSlot(room, "white"),
        black: this.toSlot(room, "black"),
      },
    };
  }

  private broadcastSnapshot(room: Room): void {
    const snapshot = this.toSnapshot(room);
    const message = JSON.stringify({
      type: "snapshot",
      snapshot,
    });

    for (const [socket] of room.connections.entries()) {
      if (socket.readyState !== WebSocket.OPEN) {
        room.connections.delete(socket);
        continue;
      }

      socket.send(message);
    }
  }
}

export const gameService = new GameService();
