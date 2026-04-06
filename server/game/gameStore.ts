import {
  GameState,
  MultiplayerRematchState,
  MultiplayerTakebackState,
  MultiplayerRoomType,
  MultiplayerStatus,
  PlayerColor,
  TimeControl,
  cloneGameState,
  SparsePositions,
  positionsToSparse,
  sparseToPositions,
  CompactHistory,
  historyToCompact,
  compactToHistory,
} from "../../shared/src";
import type { RatingStatus } from "../models/GameRoom";
import GameRoom from "../models/GameRoom";

/**
 * Slim stored identity — only what we persist in the DB.
 * Full profile (profilePicture, rating, badges, etc.) is resolved
 * from the player identity cache at read time.
 */
export type StoredPlayerIdentity = {
  playerId: string;
  displayName: string;
  kind: "guest" | "account";
};

export type StoredSeatAssignments = Record<PlayerColor, StoredPlayerIdentity | null>;

export type StoredMultiplayerRoom = {
  id: string;
  roomType: MultiplayerRoomType;
  status: MultiplayerStatus;
  state: GameState;
  rematch: MultiplayerRematchState | null;
  takeback: MultiplayerTakebackState | null;
  seats: StoredSeatAssignments;
  timeControl: TimeControl;
  clockMs: { white: number; black: number } | null;
  lastMoveAt: Date | null;
  /** Deadline for the first move in timed games; null after first move or in untimed games */
  firstMoveDeadline: Date | null;
  ratingBefore: { white: number; black: number } | null;
  ratingAfter: { white: number; black: number } | null;
  ratingStatus: RatingStatus;
  tournamentId: string | null;
  tournamentMatchId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateStoredMultiplayerRoomInput = {
  id: string;
  roomType: MultiplayerRoomType;
  status: MultiplayerStatus;
  state: GameState;
  rematch: MultiplayerRematchState | null;
  takeback: MultiplayerTakebackState | null;
  seats: StoredSeatAssignments;
  timeControl: TimeControl;
  clockMs: { white: number; black: number } | null;
  lastMoveAt: Date | null;
  firstMoveDeadline: Date | null;
  ratingBefore?: { white: number; black: number } | null;
  ratingAfter?: { white: number; black: number } | null;
  ratingStatus?: RatingStatus;
  tournamentId?: string | null;
  tournamentMatchId?: string | null;
};

export interface GameRoomStore {
  createRoom(room: CreateStoredMultiplayerRoomInput): Promise<StoredMultiplayerRoom>;
  getRoom(roomId: string): Promise<StoredMultiplayerRoom | null>;
  saveRoom(room: StoredMultiplayerRoom): Promise<StoredMultiplayerRoom>;
  listRoomsForPlayer(playerId: string): Promise<StoredMultiplayerRoom[]>;
  listActiveRoomsForPlayer(playerId: string): Promise<StoredMultiplayerRoom[]>;
  findUnfinishedRoomByPlayer(playerId: string): Promise<StoredMultiplayerRoom | null>;
  findRoomByTournamentMatch(
    tournamentId: string,
    matchId: string,
  ): Promise<StoredMultiplayerRoom | null>;
  listFinishedRoomsForPlayer(
    playerId: string,
    limit: number,
    beforeDate?: Date,
  ): Promise<StoredMultiplayerRoom[]>;
  deleteRoom(roomId: string): Promise<void>;
  findActiveTimedRooms(): Promise<StoredMultiplayerRoom[]>;
  migratePlayerIdentity(oldPlayerId: string, newIdentity: StoredPlayerIdentity): Promise<number>;
  findRoomsWithPendingRatings(): Promise<StoredMultiplayerRoom[]>;
  unlinkTournamentGames(tournamentId: string): Promise<number>;
}

function normalizeRoomId(roomId: string): string {
  return roomId.trim().toUpperCase();
}

function cloneSeats(seats: StoredSeatAssignments): StoredSeatAssignments {
  return {
    white: seats.white ? { ...seats.white } : null,
    black: seats.black ? { ...seats.black } : null,
  };
}

function cloneRematch(rematch: MultiplayerRematchState | null): MultiplayerRematchState | null {
  if (!rematch) {
    return null;
  }

  return {
    requestedBy: [...rematch.requestedBy],
  };
}

function cloneTakeback(
  takeback: MultiplayerTakebackState | null | undefined,
): MultiplayerTakebackState | null {
  if (!takeback) {
    return null;
  }

  return {
    requestedBy: takeback.requestedBy,
    declinedCount: { ...takeback.declinedCount },
  };
}

// --- Sparse board persistence helpers ---

/** State stored in the `state` field — positions are sparse, history is EXCLUDED. */
type DehydratedGameState = Omit<GameState, "positions" | "history"> & {
  stones: SparsePositions;
};

/** Legacy format that included compact history inline in state. */
type LegacyDehydratedGameState = DehydratedGameState & { h: CompactHistory };

function dehydrateGameState(state: GameState): DehydratedGameState {
  const { positions, history: _history, ...rest } = state;
  return {
    ...rest,
    stones: positionsToSparse(positions),
  };
}

type RawGameState = DehydratedGameState | LegacyDehydratedGameState | GameState;

/**
 * Hydrate a stored game state, optionally merging in separate moveHistory.
 * Handles both legacy (history inline as `h`) and new (separate moveHistory) formats.
 */
function hydrateGameState(
  raw: Record<string, unknown>,
  moveHistory?: CompactHistory | null,
): GameState {
  const r = raw as RawGameState;

  // Hydrate positions
  const positions =
    "stones" in r && !("positions" in r)
      ? sparseToPositions(r.stones, (r as DehydratedGameState).boardSize)
      : (r as GameState).positions;

  // Hydrate history: prefer separate moveHistory, fall back to inline `h`, then inline `history`
  let history: GameState["history"];
  if (moveHistory && moveHistory.m.length > 0) {
    history = compactToHistory(moveHistory);
  } else if ("h" in r && !("history" in r)) {
    history = compactToHistory((r as LegacyDehydratedGameState).h);
  } else {
    history = (r as GameState).history ?? [];
  }

  return { ...r, positions, history } as GameState;
}

export function cloneStoredRoom(room: StoredMultiplayerRoom): StoredMultiplayerRoom {
  return {
    id: room.id,
    roomType: room.roomType,
    status: room.status,
    state: cloneGameState(room.state),
    rematch: cloneRematch(room.rematch),
    takeback: cloneTakeback(room.takeback),
    seats: cloneSeats(room.seats),
    timeControl: room.timeControl ? { ...room.timeControl } : null,
    clockMs: room.clockMs ? { ...room.clockMs } : null,
    lastMoveAt: room.lastMoveAt ? new Date(room.lastMoveAt) : null,
    firstMoveDeadline: room.firstMoveDeadline ? new Date(room.firstMoveDeadline) : null,
    ratingBefore: room.ratingBefore ? { ...room.ratingBefore } : null,
    ratingAfter: room.ratingAfter ? { ...room.ratingAfter } : null,
    ratingStatus: room.ratingStatus,
    tournamentId: room.tournamentId,
    tournamentMatchId: room.tournamentMatchId,
    createdAt: new Date(room.createdAt),
    updatedAt: new Date(room.updatedAt),
  };
}

type PersistedGameRoom = {
  roomId: string;
  roomType?: MultiplayerRoomType;
  status: MultiplayerStatus;
  state: GameState;
  moveHistory?: CompactHistory | null;
  rematch?: MultiplayerRematchState | null;
  takeback?: MultiplayerTakebackState | null;
  seats: StoredSeatAssignments;
  timeControl?: TimeControl;
  clockMs?: { white: number; black: number } | null;
  lastMoveAt?: Date | null;
  firstMoveDeadline?: Date | null;
  ratingBefore?: { white: number; black: number } | null;
  ratingAfter?: { white: number; black: number } | null;
  ratingStatus?: RatingStatus;
  tournamentId?: string | null;
  tournamentMatchId?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toStoredRoom(room: PersistedGameRoom): StoredMultiplayerRoom {
  const state = cloneGameState(
    hydrateGameState(room.state as unknown as Record<string, unknown>, room.moveHistory),
  );
  return {
    id: room.roomId,
    roomType: room.roomType ?? "direct",
    status: room.status,
    state,
    rematch: cloneRematch(room.rematch ?? null),
    takeback: cloneTakeback(room.takeback ?? null),
    seats: cloneSeats(room.seats),
    timeControl: room.timeControl ?? null,
    clockMs: room.clockMs ?? null,
    lastMoveAt: room.lastMoveAt ? new Date(room.lastMoveAt) : null,
    firstMoveDeadline: room.firstMoveDeadline ? new Date(room.firstMoveDeadline) : null,
    ratingBefore: room.ratingBefore ?? null,
    ratingAfter: room.ratingAfter ?? null,
    ratingStatus: room.ratingStatus ?? null,
    tournamentId: room.tournamentId ?? null,
    tournamentMatchId: room.tournamentMatchId ?? null,
    createdAt: new Date(room.createdAt),
    updatedAt: new Date(room.updatedAt),
  };
}

/** Query filter: room has this player seated (white or black). */
function seatedPlayerFilter(playerId: string) {
  return {
    $or: [{ "seats.white.playerId": playerId }, { "seats.black.playerId": playerId }],
  };
}

/** Check if a player is seated in a room (in-memory). */
function isSeated(room: StoredMultiplayerRoom, playerId: string): boolean {
  return room.seats.white?.playerId === playerId || room.seats.black?.playerId === playerId;
}

export class MongoGameRoomStore implements GameRoomStore {
  async createRoom(room: CreateStoredMultiplayerRoomInput): Promise<StoredMultiplayerRoom> {
    const createdRoom = await GameRoom.create({
      roomId: normalizeRoomId(room.id),
      roomType: room.roomType,
      status: room.status,
      state: dehydrateGameState(room.state),
      moveHistory: historyToCompact(room.state.history),
      rematch: cloneRematch(room.rematch),
      takeback: cloneTakeback(room.takeback),
      seats: cloneSeats(room.seats),
      timeControl: room.timeControl,
      clockMs: room.clockMs,
      lastMoveAt: room.lastMoveAt,
      firstMoveDeadline: room.firstMoveDeadline,
      ratingBefore: room.ratingBefore ?? null,
      ratingAfter: room.ratingAfter ?? null,
      ratingStatus: room.ratingStatus ?? null,
      tournamentId: room.tournamentId ?? null,
      tournamentMatchId: room.tournamentMatchId ?? null,
      staleAt: room.status === "waiting" ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
    });

    return toStoredRoom({
      roomId: createdRoom.roomId,
      roomType: createdRoom.roomType,
      status: createdRoom.status,
      state: createdRoom.state,
      rematch: createdRoom.rematch,
      takeback: createdRoom.takeback,
      seats: createdRoom.seats,
      timeControl: createdRoom.timeControl,
      clockMs: createdRoom.clockMs,
      lastMoveAt: createdRoom.lastMoveAt,
      firstMoveDeadline: createdRoom.firstMoveDeadline,
      ratingStatus: createdRoom.ratingStatus,
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

  async deleteRoom(roomId: string): Promise<void> {
    await GameRoom.deleteOne({ roomId: normalizeRoomId(roomId) });
  }

  async findActiveTimedRooms(): Promise<StoredMultiplayerRoom[]> {
    const rooms = await GameRoom.find({
      status: "active",
      clockMs: { $ne: null },
      lastMoveAt: { $ne: null },
    })
      .lean<PersistedGameRoom[]>()
      .exec();

    return rooms.map(toStoredRoom);
  }

  async saveRoom(room: StoredMultiplayerRoom): Promise<StoredMultiplayerRoom> {
    const updatedRoom = await GameRoom.findOneAndUpdate(
      { roomId: normalizeRoomId(room.id) },
      {
        $set: {
          roomType: room.roomType,
          status: room.status,
          state: dehydrateGameState(room.state),
          moveHistory: historyToCompact(room.state.history),
          rematch: cloneRematch(room.rematch),
          takeback: cloneTakeback(room.takeback),
          seats: cloneSeats(room.seats),
          timeControl: room.timeControl,
          clockMs: room.clockMs,
          lastMoveAt: room.lastMoveAt,
          firstMoveDeadline: room.firstMoveDeadline,
          ratingBefore: room.ratingBefore,
          ratingAfter: room.ratingAfter,
          ratingStatus: room.ratingStatus,
          tournamentId: room.tournamentId,
          tournamentMatchId: room.tournamentMatchId,
          staleAt: room.status === "waiting" ? undefined : null,
        },
      },
      { new: true },
    )
      .lean<PersistedGameRoom>()
      .exec();

    if (!updatedRoom) {
      throw new Error("Unable to save room because it does not exist.");
    }

    return toStoredRoom(updatedRoom);
  }

  async listRoomsForPlayer(playerId: string): Promise<StoredMultiplayerRoom[]> {
    const rooms = await GameRoom.find(seatedPlayerFilter(playerId))
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean<PersistedGameRoom[]>()
      .exec();

    return rooms.map(toStoredRoom);
  }

  async listActiveRoomsForPlayer(playerId: string): Promise<StoredMultiplayerRoom[]> {
    const rooms = await GameRoom.find({
      status: { $in: ["waiting", "active"] },
      ...seatedPlayerFilter(playerId),
    })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean<PersistedGameRoom[]>()
      .exec();

    return rooms.map(toStoredRoom);
  }

  async listFinishedRoomsForPlayer(
    playerId: string,
    limit: number,
    beforeDate?: Date,
  ): Promise<StoredMultiplayerRoom[]> {
    const filter: Record<string, unknown> = {
      status: "finished",
      ...seatedPlayerFilter(playerId),
    };
    if (beforeDate) {
      filter.updatedAt = { $lt: beforeDate };
    }

    const rooms = await GameRoom.find(filter)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<PersistedGameRoom[]>()
      .exec();

    return rooms.map(toStoredRoom);
  }

  async findUnfinishedRoomByPlayer(playerId: string): Promise<StoredMultiplayerRoom | null> {
    const room = await GameRoom.findOne({
      status: {
        $in: ["waiting", "active"],
      },
      ...seatedPlayerFilter(playerId),
    })
      .sort({ updatedAt: -1 })
      .lean<PersistedGameRoom>()
      .exec();

    return room ? toStoredRoom(room) : null;
  }

  async findRoomByTournamentMatch(
    tournamentId: string,
    matchId: string,
  ): Promise<StoredMultiplayerRoom | null> {
    const room = await GameRoom.findOne({
      tournamentId,
      tournamentMatchId: matchId,
    })
      .lean<PersistedGameRoom>()
      .exec();

    return room ? toStoredRoom(room) : null;
  }

  async migratePlayerIdentity(
    oldPlayerId: string,
    newIdentity: StoredPlayerIdentity,
  ): Promise<number> {
    // Update seats where old player is seated
    const [whiteResult, blackResult] = await Promise.all([
      GameRoom.updateMany(
        { "seats.white.playerId": oldPlayerId },
        {
          $set: {
            "seats.white.playerId": newIdentity.playerId,
            "seats.white.displayName": newIdentity.displayName,
            "seats.white.kind": newIdentity.kind,
          },
        },
      ),
      GameRoom.updateMany(
        { "seats.black.playerId": oldPlayerId },
        {
          $set: {
            "seats.black.playerId": newIdentity.playerId,
            "seats.black.displayName": newIdentity.displayName,
            "seats.black.kind": newIdentity.kind,
          },
        },
      ),
    ]);

    return whiteResult.modifiedCount + blackResult.modifiedCount;
  }

  async findRoomsWithPendingRatings(): Promise<StoredMultiplayerRoom[]> {
    const rooms = await GameRoom.find({
      status: "finished",
      ratingStatus: "pending",
    })
      .lean<PersistedGameRoom[]>()
      .exec();

    return rooms.map(toStoredRoom);
  }

  async unlinkTournamentGames(tournamentId: string): Promise<number> {
    const result = await GameRoom.updateMany(
      { tournamentId, status: { $in: ["waiting", "active"] } },
      {
        $set: {
          tournamentId: null,
          tournamentMatchId: null,
          roomType: "direct",
        },
      },
    );
    return result.modifiedCount;
  }
}

export class InMemoryGameRoomStore implements GameRoomStore {
  private rooms = new Map<string, StoredMultiplayerRoom>();

  async createRoom(room: CreateStoredMultiplayerRoomInput): Promise<StoredMultiplayerRoom> {
    const normalizedId = normalizeRoomId(room.id);
    if (this.rooms.has(normalizedId)) {
      const duplicateError = new Error("Duplicate room id.");
      (duplicateError as Error & { code?: number }).code = 11000;
      throw duplicateError;
    }

    const now = new Date();
    const storedRoom: StoredMultiplayerRoom = {
      id: normalizedId,
      roomType: room.roomType,
      status: room.status,
      state: cloneGameState(room.state),
      rematch: cloneRematch(room.rematch),
      takeback: cloneTakeback(room.takeback),
      seats: cloneSeats(room.seats),
      timeControl: room.timeControl ? { ...room.timeControl } : null,
      clockMs: room.clockMs ? { ...room.clockMs } : null,
      lastMoveAt: room.lastMoveAt ? new Date(room.lastMoveAt) : null,
      firstMoveDeadline: room.firstMoveDeadline ? new Date(room.firstMoveDeadline) : null,
      ratingBefore: room.ratingBefore ?? null,
      ratingAfter: room.ratingAfter ?? null,
      ratingStatus: room.ratingStatus ?? null,
      tournamentId: room.tournamentId ?? null,
      tournamentMatchId: room.tournamentMatchId ?? null,
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

  async deleteRoom(roomId: string): Promise<void> {
    this.rooms.delete(normalizeRoomId(roomId));
  }

  async saveRoom(room: StoredMultiplayerRoom): Promise<StoredMultiplayerRoom> {
    const normalizedId = normalizeRoomId(room.id);
    const existingRoom = this.rooms.get(normalizedId);
    if (!existingRoom) {
      throw new Error("Unable to save room because it does not exist.");
    }

    const updatedRoom: StoredMultiplayerRoom = {
      id: normalizedId,
      roomType: room.roomType,
      status: room.status,
      state: cloneGameState(room.state),
      rematch: cloneRematch(room.rematch),
      takeback: cloneTakeback(room.takeback),
      seats: cloneSeats(room.seats),
      timeControl: room.timeControl ? { ...room.timeControl } : null,
      clockMs: room.clockMs ? { ...room.clockMs } : null,
      lastMoveAt: room.lastMoveAt ? new Date(room.lastMoveAt) : null,
      firstMoveDeadline: room.firstMoveDeadline ? new Date(room.firstMoveDeadline) : null,
      ratingBefore: room.ratingBefore ? { ...room.ratingBefore } : null,
      ratingAfter: room.ratingAfter ? { ...room.ratingAfter } : null,
      ratingStatus: room.ratingStatus,
      tournamentId: room.tournamentId,
      tournamentMatchId: room.tournamentMatchId,
      createdAt: new Date(existingRoom.createdAt),
      updatedAt: new Date(),
    };

    this.rooms.set(normalizedId, updatedRoom);
    return cloneStoredRoom(updatedRoom);
  }

  async listRoomsForPlayer(playerId: string): Promise<StoredMultiplayerRoom[]> {
    const rooms = Array.from(this.rooms.values())
      .filter((room) => isSeated(room, playerId))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return rooms.map(cloneStoredRoom);
  }

  async listActiveRoomsForPlayer(playerId: string): Promise<StoredMultiplayerRoom[]> {
    const rooms = Array.from(this.rooms.values())
      .filter((room) => room.status !== "finished" && isSeated(room, playerId))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return rooms.map(cloneStoredRoom);
  }

  async listFinishedRoomsForPlayer(
    playerId: string,
    limit: number,
    beforeDate?: Date,
  ): Promise<StoredMultiplayerRoom[]> {
    let rooms = Array.from(this.rooms.values())
      .filter((room) => room.status === "finished" && isSeated(room, playerId))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    if (beforeDate) {
      rooms = rooms.filter((room) => room.updatedAt.getTime() < beforeDate.getTime());
    }

    return rooms.slice(0, limit).map(cloneStoredRoom);
  }

  async findUnfinishedRoomByPlayer(playerId: string): Promise<StoredMultiplayerRoom | null> {
    const room = Array.from(this.rooms.values())
      .filter((candidate) => candidate.status !== "finished" && isSeated(candidate, playerId))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

    return room ? cloneStoredRoom(room) : null;
  }

  async findRoomByTournamentMatch(
    tournamentId: string,
    matchId: string,
  ): Promise<StoredMultiplayerRoom | null> {
    const room = Array.from(this.rooms.values()).find(
      (r) => r.tournamentId === tournamentId && r.tournamentMatchId === matchId,
    );
    return room ? cloneStoredRoom(room) : null;
  }

  async findActiveTimedRooms(): Promise<StoredMultiplayerRoom[]> {
    return Array.from(this.rooms.values())
      .filter(
        (room) => room.status === "active" && room.clockMs !== null && room.lastMoveAt !== null,
      )
      .map(cloneStoredRoom);
  }

  async migratePlayerIdentity(
    oldPlayerId: string,
    newIdentity: StoredPlayerIdentity,
  ): Promise<number> {
    let count = 0;
    for (const [, room] of this.rooms) {
      let modified = false;
      for (const color of ["white", "black"] as const) {
        const seat = room.seats[color];
        if (seat?.playerId === oldPlayerId) {
          seat.playerId = newIdentity.playerId;
          seat.displayName = newIdentity.displayName;
          seat.kind = newIdentity.kind;
          modified = true;
        }
      }
      if (modified) count++;
    }
    return count;
  }

  async findRoomsWithPendingRatings(): Promise<StoredMultiplayerRoom[]> {
    return Array.from(this.rooms.values())
      .filter((room) => room.status === "finished" && room.ratingStatus === "pending")
      .map(cloneStoredRoom);
  }

  async unlinkTournamentGames(tournamentId: string): Promise<number> {
    let count = 0;
    for (const [, room] of this.rooms) {
      if (room.tournamentId === tournamentId && room.status !== "finished") {
        room.tournamentId = null;
        room.tournamentMatchId = null;
        room.roomType = "direct";
        count++;
      }
    }
    return count;
  }
}

export function getPlayerColorForRoom(
  room: { seats: StoredSeatAssignments },
  playerId: string,
): PlayerColor | null {
  if (room.seats.white?.playerId === playerId) {
    return "white";
  }

  if (room.seats.black?.playerId === playerId) {
    return "black";
  }

  return null;
}
