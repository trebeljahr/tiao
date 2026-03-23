import {
  GameState,
  MultiplayerSeatAssignments,
  MultiplayerStatus,
  PlayerColor,
  cloneGameState,
} from "../../shared/src";
import GameRoom from "../models/GameRoom";

export type StoredMultiplayerRoom = {
  id: string;
  status: MultiplayerStatus;
  state: GameState;
  seats: MultiplayerSeatAssignments;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateStoredMultiplayerRoomInput = {
  id: string;
  status: MultiplayerStatus;
  state: GameState;
  seats: MultiplayerSeatAssignments;
};

export interface GameRoomStore {
  createRoom(room: CreateStoredMultiplayerRoomInput): Promise<StoredMultiplayerRoom>;
  getRoom(roomId: string): Promise<StoredMultiplayerRoom | null>;
  saveRoom(room: StoredMultiplayerRoom): Promise<StoredMultiplayerRoom>;
  listRoomsForPlayer(playerId: string): Promise<StoredMultiplayerRoom[]>;
  findUnfinishedRoomByPlayer(
    playerId: string
  ): Promise<StoredMultiplayerRoom | null>;
}

function normalizeRoomId(roomId: string): string {
  return roomId.trim().toUpperCase();
}

function cloneSeats(seats: MultiplayerSeatAssignments): MultiplayerSeatAssignments {
  return {
    white: seats.white ? { ...seats.white } : null,
    black: seats.black ? { ...seats.black } : null,
  };
}

export function cloneStoredRoom(room: StoredMultiplayerRoom): StoredMultiplayerRoom {
  return {
    id: room.id,
    status: room.status,
    state: cloneGameState(room.state),
    seats: cloneSeats(room.seats),
    createdAt: new Date(room.createdAt),
    updatedAt: new Date(room.updatedAt),
  };
}

type PersistedGameRoom = {
  roomId: string;
  status: MultiplayerStatus;
  state: GameState;
  seats: MultiplayerSeatAssignments;
  createdAt: Date;
  updatedAt: Date;
};

function toStoredRoom(room: PersistedGameRoom): StoredMultiplayerRoom {
  return {
    id: room.roomId,
    status: room.status,
    state: cloneGameState(room.state),
    seats: cloneSeats(room.seats),
    createdAt: new Date(room.createdAt),
    updatedAt: new Date(room.updatedAt),
  };
}

export class MongoGameRoomStore implements GameRoomStore {
  async createRoom(
    room: CreateStoredMultiplayerRoomInput
  ): Promise<StoredMultiplayerRoom> {
    const createdRoom = await GameRoom.create({
      roomId: normalizeRoomId(room.id),
      status: room.status,
      state: cloneGameState(room.state),
      seats: cloneSeats(room.seats),
    });

    return toStoredRoom({
      roomId: createdRoom.roomId,
      status: createdRoom.status,
      state: createdRoom.state,
      seats: createdRoom.seats,
      createdAt: createdRoom.createdAt,
      updatedAt: createdRoom.updatedAt,
    });
  }

  async getRoom(roomId: string): Promise<StoredMultiplayerRoom | null> {
    const room = await GameRoom.findOne({
      roomId: normalizeRoomId(roomId),
    })
      .lean<PersistedGameRoom>()
      .exec();

    return room ? toStoredRoom(room) : null;
  }

  async saveRoom(room: StoredMultiplayerRoom): Promise<StoredMultiplayerRoom> {
    const updatedRoom = await GameRoom.findOneAndUpdate(
      {
        roomId: normalizeRoomId(room.id),
      },
      {
        $set: {
          status: room.status,
          state: cloneGameState(room.state),
          seats: cloneSeats(room.seats),
        },
      },
      {
        new: true,
      }
    )
      .lean<PersistedGameRoom>()
      .exec();

    if (!updatedRoom) {
      throw new Error("Unable to save room because it does not exist.");
    }

    return toStoredRoom(updatedRoom);
  }

  async listRoomsForPlayer(playerId: string): Promise<StoredMultiplayerRoom[]> {
    const rooms = await GameRoom.find({
      $or: [
        { "seats.white.playerId": playerId },
        { "seats.black.playerId": playerId },
      ],
    })
      .sort({ updatedAt: -1 })
      .lean<PersistedGameRoom[]>()
      .exec();

    return rooms.map(toStoredRoom);
  }

  async findUnfinishedRoomByPlayer(
    playerId: string
  ): Promise<StoredMultiplayerRoom | null> {
    const room = await GameRoom.findOne({
      status: {
        $in: ["waiting", "active"],
      },
      $or: [
        { "seats.white.playerId": playerId },
        { "seats.black.playerId": playerId },
      ],
    })
      .sort({ updatedAt: -1 })
      .lean<PersistedGameRoom>()
      .exec();

    return room ? toStoredRoom(room) : null;
  }
}

export class InMemoryGameRoomStore implements GameRoomStore {
  private rooms = new Map<string, StoredMultiplayerRoom>();

  async createRoom(
    room: CreateStoredMultiplayerRoomInput
  ): Promise<StoredMultiplayerRoom> {
    const normalizedId = normalizeRoomId(room.id);
    if (this.rooms.has(normalizedId)) {
      const duplicateError = new Error("Duplicate room id.");
      (duplicateError as Error & { code?: number }).code = 11000;
      throw duplicateError;
    }

    const now = new Date();
    const storedRoom: StoredMultiplayerRoom = {
      id: normalizedId,
      status: room.status,
      state: cloneGameState(room.state),
      seats: cloneSeats(room.seats),
      createdAt: now,
      updatedAt: now,
    };

    this.rooms.set(normalizedId, storedRoom);
    return cloneStoredRoom(storedRoom);
  }

  async getRoom(roomId: string): Promise<StoredMultiplayerRoom | null> {
    const room = this.rooms.get(normalizeRoomId(roomId));
    return room ? cloneStoredRoom(room) : null;
  }

  async saveRoom(room: StoredMultiplayerRoom): Promise<StoredMultiplayerRoom> {
    const normalizedId = normalizeRoomId(room.id);
    const existingRoom = this.rooms.get(normalizedId);
    if (!existingRoom) {
      throw new Error("Unable to save room because it does not exist.");
    }

    const updatedRoom: StoredMultiplayerRoom = {
      id: normalizedId,
      status: room.status,
      state: cloneGameState(room.state),
      seats: cloneSeats(room.seats),
      createdAt: new Date(existingRoom.createdAt),
      updatedAt: new Date(),
    };

    this.rooms.set(normalizedId, updatedRoom);
    return cloneStoredRoom(updatedRoom);
  }

  async listRoomsForPlayer(playerId: string): Promise<StoredMultiplayerRoom[]> {
    const rooms = Array.from(this.rooms.values())
      .filter(
        (room) =>
          room.seats.white?.playerId === playerId ||
          room.seats.black?.playerId === playerId
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return rooms.map(cloneStoredRoom);
  }

  async findUnfinishedRoomByPlayer(
    playerId: string
  ): Promise<StoredMultiplayerRoom | null> {
    const room = Array.from(this.rooms.values())
      .filter(
        (candidate) =>
          candidate.status !== "finished" &&
          (candidate.seats.white?.playerId === playerId ||
            candidate.seats.black?.playerId === playerId)
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

    return room ? cloneStoredRoom(room) : null;
  }
}

export function getPlayerColorForRoom(
  room: { seats: MultiplayerSeatAssignments },
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
