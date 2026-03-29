import {
  GameState,
  MultiplayerRematchState,
  MultiplayerTakebackState,
  MultiplayerSeatAssignments,
  MultiplayerRoomType,
  MultiplayerStatus,
  PlayerColor,
  PlayerIdentity,
  TimeControl,
  cloneGameState,
  SparsePositions,
  positionsToSparse,
  sparseToPositions,
  CompactHistory,
  historyToCompact,
  compactToHistory,
} from "../../shared/src";
import GameRoom from "../models/GameRoom";

export type StoredMultiplayerRoom = {
  id: string;
  roomType: MultiplayerRoomType;
  status: MultiplayerStatus;
  state: GameState;
  players: PlayerIdentity[];
  rematch: MultiplayerRematchState | null;
  takeback: MultiplayerTakebackState | null;
  seats: MultiplayerSeatAssignments;
  timeControl: TimeControl;
  clockMs: { white: number; black: number } | null;
  lastMoveAt: Date | null;
  /** Deadline for the first move in timed games; null after first move or in untimed games */
  firstMoveDeadline: Date | null;
  ratingBefore: { white: number; black: number } | null;
  ratingAfter: { white: number; black: number } | null;
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
  players: PlayerIdentity[];
  rematch: MultiplayerRematchState | null;
  takeback: MultiplayerTakebackState | null;
  seats: MultiplayerSeatAssignments;
  timeControl: TimeControl;
  clockMs: { white: number; black: number } | null;
  lastMoveAt: Date | null;
  firstMoveDeadline: Date | null;
  ratingBefore?: { white: number; black: number } | null;
  ratingAfter?: { white: number; black: number } | null;
  tournamentId?: string | null;
  tournamentMatchId?: string | null;
};

export interface GameRoomStore {
  createRoom(room: CreateStoredMultiplayerRoomInput): Promise<StoredMultiplayerRoom>;
  getRoom(roomId: string): Promise<StoredMultiplayerRoom | null>;
  saveRoom(room: StoredMultiplayerRoom): Promise<StoredMultiplayerRoom>;
  listRoomsForPlayer(playerId: string): Promise<StoredMultiplayerRoom[]>;
  findUnfinishedRoomByPlayer(playerId: string): Promise<StoredMultiplayerRoom | null>;
  findRoomByTournamentMatch(
    tournamentId: string,
    matchId: string,
  ): Promise<StoredMultiplayerRoom | null>;
  migratePlayerIdentity(oldPlayerId: string, newIdentity: PlayerIdentity): Promise<number>;
  unlinkTournamentGames(tournamentId: string): Promise<number>;
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

function clonePlayers(players: PlayerIdentity[]): PlayerIdentity[] {
  return players.map((player) => ({ ...player }));
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

type DehydratedGameState = Omit<GameState, "positions" | "history"> & {
  stones: SparsePositions;
  h: CompactHistory;
};

function dehydrateGameState(state: GameState): DehydratedGameState {
  const { positions, history, ...rest } = state;
  return {
    ...rest,
    stones: positionsToSparse(positions),
    h: historyToCompact(history),
  };
}

function hydrateGameState(raw: Record<string, unknown>): GameState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;

  // Hydrate positions
  const positions =
    "stones" in r && !("positions" in r) ? sparseToPositions(r.stones, r.boardSize) : r.positions;

  // Hydrate history
  const history = "h" in r && !("history" in r) ? compactToHistory(r.h) : r.history;

  return { ...r, positions, history } as GameState;
}

export function cloneStoredRoom(room: StoredMultiplayerRoom): StoredMultiplayerRoom {
  return {
    id: room.id,
    roomType: room.roomType,
    status: room.status,
    state: cloneGameState(room.state),
    players: clonePlayers(room.players),
    rematch: cloneRematch(room.rematch),
    takeback: cloneTakeback(room.takeback),
    seats: cloneSeats(room.seats),
    timeControl: room.timeControl ? { ...room.timeControl } : null,
    clockMs: room.clockMs ? { ...room.clockMs } : null,
    lastMoveAt: room.lastMoveAt ? new Date(room.lastMoveAt) : null,
    firstMoveDeadline: room.firstMoveDeadline ? new Date(room.firstMoveDeadline) : null,
    ratingBefore: room.ratingBefore ? { ...room.ratingBefore } : null,
    ratingAfter: room.ratingAfter ? { ...room.ratingAfter } : null,
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
  players?: PlayerIdentity[];
  rematch?: MultiplayerRematchState | null;
  takeback?: MultiplayerTakebackState | null;
  seats: MultiplayerSeatAssignments;
  timeControl?: TimeControl;
  clockMs?: { white: number; black: number } | null;
  lastMoveAt?: Date | null;
  firstMoveDeadline?: Date | null;
  ratingBefore?: { white: number; black: number } | null;
  ratingAfter?: { white: number; black: number } | null;
  tournamentId?: string | null;
  tournamentMatchId?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toStoredRoom(room: PersistedGameRoom): StoredMultiplayerRoom {
  const players = clonePlayers(room.players ?? []);

  for (const color of ["white", "black"] as PlayerColor[]) {
    const seatedPlayer = room.seats[color];

    if (seatedPlayer && !players.some((player) => player.playerId === seatedPlayer.playerId)) {
      players.push({ ...seatedPlayer });
    }
  }

  return {
    id: room.roomId,
    roomType: room.roomType ?? "direct",
    status: room.status,
    state: cloneGameState(hydrateGameState(room.state as unknown as Record<string, unknown>)),
    players,
    rematch: cloneRematch(room.rematch ?? null),
    takeback: cloneTakeback(room.takeback ?? null),
    seats: cloneSeats(room.seats),
    timeControl: room.timeControl ?? null,
    clockMs: room.clockMs ?? null,
    lastMoveAt: room.lastMoveAt ? new Date(room.lastMoveAt) : null,
    firstMoveDeadline: room.firstMoveDeadline ? new Date(room.firstMoveDeadline) : null,
    ratingBefore: room.ratingBefore ?? null,
    ratingAfter: room.ratingAfter ?? null,
    tournamentId: room.tournamentId ?? null,
    tournamentMatchId: room.tournamentMatchId ?? null,
    createdAt: new Date(room.createdAt),
    updatedAt: new Date(room.updatedAt),
  };
}

export class MongoGameRoomStore implements GameRoomStore {
  async createRoom(room: CreateStoredMultiplayerRoomInput): Promise<StoredMultiplayerRoom> {
    const createdRoom = await GameRoom.create({
      roomId: normalizeRoomId(room.id),
      roomType: room.roomType,
      status: room.status,
      state: dehydrateGameState(room.state),
      players: clonePlayers(room.players),
      rematch: cloneRematch(room.rematch),
      takeback: cloneTakeback(room.takeback),
      seats: cloneSeats(room.seats),
      timeControl: room.timeControl,
      clockMs: room.clockMs,
      lastMoveAt: room.lastMoveAt,
      firstMoveDeadline: room.firstMoveDeadline,
      ratingBefore: room.ratingBefore ?? null,
      ratingAfter: room.ratingAfter ?? null,
      tournamentId: room.tournamentId ?? null,
      tournamentMatchId: room.tournamentMatchId ?? null,
      staleAt: room.status === "waiting" ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
    });

    return toStoredRoom({
      roomId: createdRoom.roomId,
      roomType: createdRoom.roomType,
      status: createdRoom.status,
      state: createdRoom.state,
      players: createdRoom.players,
      rematch: createdRoom.rematch,
      takeback: createdRoom.takeback,
      seats: createdRoom.seats,
      timeControl: createdRoom.timeControl,
      clockMs: createdRoom.clockMs,
      lastMoveAt: createdRoom.lastMoveAt,
      firstMoveDeadline: createdRoom.firstMoveDeadline,
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
          roomType: room.roomType,
          status: room.status,
          state: dehydrateGameState(room.state),
          players: clonePlayers(room.players),
          rematch: cloneRematch(room.rematch),
          takeback: cloneTakeback(room.takeback),
          seats: cloneSeats(room.seats),
          timeControl: room.timeControl,
          clockMs: room.clockMs,
          lastMoveAt: room.lastMoveAt,
          firstMoveDeadline: room.firstMoveDeadline,
          ratingBefore: room.ratingBefore,
          ratingAfter: room.ratingAfter,
          tournamentId: room.tournamentId,
          tournamentMatchId: room.tournamentMatchId,
          staleAt: room.status === "waiting" ? undefined : null,
        },
      },
      {
        new: true,
      },
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
        { "players.playerId": playerId },
        { "seats.white.playerId": playerId },
        { "seats.black.playerId": playerId },
      ],
    })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean<PersistedGameRoom[]>()
      .exec();

    return rooms.map(toStoredRoom);
  }

  async findUnfinishedRoomByPlayer(playerId: string): Promise<StoredMultiplayerRoom | null> {
    const room = await GameRoom.findOne({
      status: {
        $in: ["waiting", "active"],
      },
      $or: [
        { "players.playerId": playerId },
        { "seats.white.playerId": playerId },
        { "seats.black.playerId": playerId },
      ],
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

  async migratePlayerIdentity(oldPlayerId: string, newIdentity: PlayerIdentity): Promise<number> {
    // Update ALL rooms where the old player appears (including finished games)
    const result = await GameRoom.updateMany(
      { "players.playerId": oldPlayerId },
      {
        $set: {
          "players.$[p].playerId": newIdentity.playerId,
          "players.$[p].displayName": newIdentity.displayName,
          "players.$[p].kind": newIdentity.kind,
          "players.$[p].profilePicture": newIdentity.profilePicture,
        },
      },
      {
        arrayFilters: [{ "p.playerId": oldPlayerId }],
      },
    );

    // Also update seats
    await GameRoom.updateMany(
      { "seats.white.playerId": oldPlayerId },
      {
        $set: {
          "seats.white.playerId": newIdentity.playerId,
          "seats.white.displayName": newIdentity.displayName,
          "seats.white.kind": newIdentity.kind,
          "seats.white.profilePicture": newIdentity.profilePicture,
        },
      },
    );

    await GameRoom.updateMany(
      { "seats.black.playerId": oldPlayerId },
      {
        $set: {
          "seats.black.playerId": newIdentity.playerId,
          "seats.black.displayName": newIdentity.displayName,
          "seats.black.kind": newIdentity.kind,
          "seats.black.profilePicture": newIdentity.profilePicture,
        },
      },
    );

    return result.modifiedCount;
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
      players: clonePlayers(room.players),
      rematch: cloneRematch(room.rematch),
      takeback: cloneTakeback(room.takeback),
      seats: cloneSeats(room.seats),
      timeControl: room.timeControl ? { ...room.timeControl } : null,
      clockMs: room.clockMs ? { ...room.clockMs } : null,
      lastMoveAt: room.lastMoveAt ? new Date(room.lastMoveAt) : null,
      firstMoveDeadline: room.firstMoveDeadline ? new Date(room.firstMoveDeadline) : null,
      ratingBefore: room.ratingBefore ?? null,
      ratingAfter: room.ratingAfter ?? null,
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
      players: clonePlayers(room.players),
      rematch: cloneRematch(room.rematch),
      takeback: cloneTakeback(room.takeback),
      seats: cloneSeats(room.seats),
      timeControl: room.timeControl ? { ...room.timeControl } : null,
      clockMs: room.clockMs ? { ...room.clockMs } : null,
      lastMoveAt: room.lastMoveAt ? new Date(room.lastMoveAt) : null,
      firstMoveDeadline: room.firstMoveDeadline ? new Date(room.firstMoveDeadline) : null,
      ratingBefore: room.ratingBefore ? { ...room.ratingBefore } : null,
      ratingAfter: room.ratingAfter ? { ...room.ratingAfter } : null,
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
      .filter((room) => room.players.some((player) => player.playerId === playerId))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return rooms.map(cloneStoredRoom);
  }

  async findUnfinishedRoomByPlayer(playerId: string): Promise<StoredMultiplayerRoom | null> {
    const room = Array.from(this.rooms.values())
      .filter(
        (candidate) =>
          candidate.status !== "finished" &&
          candidate.players.some((player) => player.playerId === playerId),
      )
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

  async migratePlayerIdentity(oldPlayerId: string, newIdentity: PlayerIdentity): Promise<number> {
    let count = 0;
    for (const [, room] of this.rooms) {
      let modified = false;
      for (const p of room.players) {
        if (p.playerId === oldPlayerId) {
          p.playerId = newIdentity.playerId;
          p.displayName = newIdentity.displayName;
          p.kind = newIdentity.kind;
          p.profilePicture = newIdentity.profilePicture;
          modified = true;
        }
      }
      for (const color of ["white", "black"] as const) {
        const seat = room.seats[color];
        if (seat?.playerId === oldPlayerId) {
          seat.playerId = newIdentity.playerId;
          seat.displayName = newIdentity.displayName;
          seat.kind = newIdentity.kind;
          seat.profilePicture = newIdentity.profilePicture;
          modified = true;
        }
      }
      if (modified) count++;
    }
    return count;
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
  room: { seats: MultiplayerSeatAssignments },
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
