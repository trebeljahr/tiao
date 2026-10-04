import type {
  TournamentGroup,
  TournamentParticipant,
  TournamentRound,
  TournamentSettings,
  TournamentStatus,
} from "../../shared/src";
import Tournament, { type ITournament } from "../models/Tournament";
import { assertCurrentLocks, currentLockToken } from "./lockContext";

export type StoredTournament = {
  authorityToken?: string | null;
  revision?: number;
  registrationAbsences?: { playerId: string; since: number }[];
  completionEffectsPending?: boolean;
  cleanupPending?: boolean;
  deletedAt?: Date | null;
  tournamentId: string;
  name: string;
  description?: string;
  creatorId: string;
  status: TournamentStatus;
  settings: TournamentSettings;
  participants: TournamentParticipant[];
  rounds: TournamentRound[];
  groups: TournamentGroup[];
  knockoutRounds: TournamentRound[];
  featuredMatchId: string | null;
  isFeatured: boolean;
  invitedUserIds: string[];
  createdAt: Date;
  updatedAt: Date;
};

export interface TournamentStore {
  createTournament(
    tournament: Omit<StoredTournament, "createdAt" | "updatedAt">,
  ): Promise<StoredTournament>;
  getTournament(tournamentId: string, includeDeleted?: boolean): Promise<StoredTournament | null>;
  saveTournament(tournament: StoredTournament): Promise<StoredTournament>;
  listPublicTournaments(options?: { status?: TournamentStatus }): Promise<StoredTournament[]>;
  /** Admin-only: returns every tournament regardless of visibility. */
  listAllTournaments(): Promise<StoredTournament[]>;
  listTournamentsForPlayer(playerId: string): Promise<StoredTournament[]>;
  findTournamentByMatchRoomId(roomId: string): Promise<StoredTournament | null>;
  findRegistrationTournamentsByParticipant(playerId: string): Promise<StoredTournament[]>;
  listTournamentsForInvitedUser(playerId: string): Promise<StoredTournament[]>;
  countOngoingTournamentsByCreator(creatorId: string): Promise<number>;
  deleteTournament(tournamentId: string, expected?: StoredTournament): Promise<void>;
  listRecoveryTournaments(after?: string, limit?: number): Promise<StoredTournament[]>;
}

// Statuses considered "ongoing" for the per-creator limit.
export const ONGOING_TOURNAMENT_STATUSES: TournamentStatus[] = ["draft", "registration", "active"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toStoredTournament(
  doc: ITournament | StoredTournament | Record<string, any>,
): StoredTournament {
  const obj = "toObject" in doc && typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    authorityToken: obj.authorityToken ?? null,
    revision: obj.revision ?? 0,
    registrationAbsences: obj.registrationAbsences ?? [],
    completionEffectsPending: obj.completionEffectsPending ?? false,
    cleanupPending: obj.cleanupPending ?? false,
    deletedAt: obj.deletedAt ? new Date(obj.deletedAt) : null,
    tournamentId: obj.tournamentId,
    name: obj.name,
    description: obj.description,
    creatorId: obj.creatorId,
    status: obj.status,
    settings: obj.settings,
    participants: obj.participants ?? [],
    rounds: obj.rounds ?? [],
    groups: obj.groups ?? [],
    knockoutRounds: obj.knockoutRounds ?? [],
    featuredMatchId: obj.featuredMatchId ?? null,
    isFeatured: obj.isFeatured ?? false,
    invitedUserIds: obj.invitedUserIds ?? [],
    createdAt: new Date(obj.createdAt),
    updatedAt: new Date(obj.updatedAt),
  };
}

export async function claimTournamentAuthority(key: string, token: string): Promise<void> {
  if (!key.startsWith("tournament:")) return;
  await Tournament.updateOne(
    { tournamentId: key.slice("tournament:".length) },
    { $set: { authorityToken: token } },
    { timestamps: false },
  ).exec();
}

function mutationFilter(tournament: StoredTournament) {
  const token = currentLockToken(`tournament:${tournament.tournamentId}`);
  if (
    (process.env.NODE_ENV === "production" && !token) ||
    (token && token !== tournament.authorityToken)
  )
    throw new Error("Tournament authority changed; reload before writing");
  const revision = tournament.revision ?? 0;
  return {
    tournamentId: tournament.tournamentId,
    authorityToken: tournament.authorityToken ?? null,
    ...(revision === 0
      ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { revision }),
  };
}

export class MongoTournamentStore implements TournamentStore {
  async createTournament(
    tournament: Omit<StoredTournament, "createdAt" | "updatedAt">,
  ): Promise<StoredTournament> {
    await assertCurrentLocks();
    const doc = await Tournament.create({ ...tournament, authorityToken: null, revision: 0 });
    return toStoredTournament(doc);
  }

  async getTournament(
    tournamentId: string,
    includeDeleted = false,
  ): Promise<StoredTournament | null> {
    const doc = await Tournament.findOne({
      tournamentId,
      ...(includeDeleted ? {} : { deletedAt: null }),
    })
      .lean()
      .exec();
    return doc ? toStoredTournament(doc) : null;
  }

  async saveTournament(tournament: StoredTournament): Promise<StoredTournament> {
    await assertCurrentLocks();
    const doc = await Tournament.findOneAndUpdate(
      mutationFilter(tournament),
      {
        $inc: { revision: 1 },
        $set: {
          registrationAbsences: tournament.registrationAbsences ?? [],
          completionEffectsPending: tournament.completionEffectsPending ?? false,
          cleanupPending: tournament.cleanupPending ?? false,
          name: tournament.name,
          description: tournament.description,
          status: tournament.status,
          settings: tournament.settings,
          participants: tournament.participants,
          rounds: tournament.rounds,
          groups: tournament.groups,
          knockoutRounds: tournament.knockoutRounds,
          featuredMatchId: tournament.featuredMatchId,
          isFeatured: tournament.isFeatured,
          invitedUserIds: tournament.invitedUserIds,
        },
      },
      { new: true },
    )
      .lean()
      .exec();

    if (!doc) {
      throw new Error("Tournament changed; reload before writing");
    }

    return toStoredTournament(doc);
  }

  async listPublicTournaments(options?: {
    status?: TournamentStatus;
  }): Promise<StoredTournament[]> {
    const filter: any = { "settings.visibility": "public", deletedAt: null };
    if (options?.status) {
      filter.status = options.status;
    } else {
      // Hide cancelled tournaments from the public browse list by default.
      // Creators/participants still see them via listTournamentsForPlayer.
      filter.status = { $ne: "cancelled" };
    }

    // Sort featured first, then newest first. isFeatured is boolean; Mongo
    // sorts false < true so we pass -1 to put true (featured) at the top.
    const docs = await Tournament.find(filter)
      .sort({ isFeatured: -1, createdAt: -1 })
      .limit(50)
      .lean()
      .exec();

    return docs.map(toStoredTournament);
  }

  async listAllTournaments(): Promise<StoredTournament[]> {
    const docs = await Tournament.find({ deletedAt: null })
      .sort({ isFeatured: -1, createdAt: -1 })
      .limit(200)
      .lean()
      .exec();

    return docs.map(toStoredTournament);
  }

  async countOngoingTournamentsByCreator(creatorId: string): Promise<number> {
    return Tournament.countDocuments({
      creatorId,
      deletedAt: null,
      status: { $in: ONGOING_TOURNAMENT_STATUSES },
    }).exec();
  }

  async deleteTournament(tournamentId: string, expected?: StoredTournament): Promise<void> {
    await assertCurrentLocks();
    if (!expected || expected.tournamentId !== tournamentId)
      throw new Error("Tournament deletion requires its current revision");
    // Retain a hidden tombstone: an already-sent old room insert may complete
    // after cleanup, and recovery must still know to remove that room link.
    const result = await Tournament.updateOne(mutationFilter(expected), {
      $set: {
        deletedAt: new Date(),
        status: "cancelled",
        name: "Deleted tournament",
        creatorId: "deleted",
        registrationAbsences: [],
        participants: [],
        rounds: [],
        groups: [],
        knockoutRounds: [],
        invitedUserIds: [],
        featuredMatchId: null,
        isFeatured: false,
      },
      $unset: { description: 1, "settings.inviteCode": 1 },
      $inc: { revision: 1 },
    }).exec();
    if (result.modifiedCount !== 1) throw new Error("Tournament changed; reload before deleting");
  }

  async listRecoveryTournaments(after?: string, limit = 50): Promise<StoredTournament[]> {
    const docs = await Tournament.find({
      ...(after ? { tournamentId: { $gt: after } } : {}),
      $or: [
        { status: "registration", deletedAt: null },
        { status: "active" },
        { status: "finished", completionEffectsPending: true },
        { status: "cancelled" },
      ],
    })
      .sort({ tournamentId: 1 })
      .limit(limit)
      .lean()
      .exec();
    return docs.map(toStoredTournament);
  }

  async listTournamentsForPlayer(playerId: string): Promise<StoredTournament[]> {
    const docs = await Tournament.find({
      deletedAt: null,
      $or: [
        { "participants.playerId": playerId },
        { creatorId: playerId },
        { invitedUserIds: playerId },
      ],
    })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean()
      .exec();

    return docs.map(toStoredTournament);
  }

  async listTournamentsForInvitedUser(playerId: string): Promise<StoredTournament[]> {
    const docs = await Tournament.find({ invitedUserIds: playerId, deletedAt: null })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean()
      .exec();

    return docs.map(toStoredTournament);
  }

  async findTournamentByMatchRoomId(roomId: string): Promise<StoredTournament | null> {
    const doc = await Tournament.findOne({
      $or: [
        { "rounds.matches.roomId": roomId },
        { "groups.rounds.matches.roomId": roomId },
        { "knockoutRounds.matches.roomId": roomId },
      ],
    })
      .lean()
      .exec();

    return doc ? toStoredTournament(doc) : null;
  }

  async findRegistrationTournamentsByParticipant(playerId: string): Promise<StoredTournament[]> {
    const docs = await Tournament.find({
      "participants.playerId": playerId,
      deletedAt: null,
      status: "registration",
    })
      .lean()
      .exec();

    return docs.map(toStoredTournament);
  }
}

export class InMemoryTournamentStore implements TournamentStore {
  private tournaments = new Map<string, StoredTournament>();

  async createTournament(
    tournament: Omit<StoredTournament, "createdAt" | "updatedAt">,
  ): Promise<StoredTournament> {
    if (this.tournaments.has(tournament.tournamentId)) {
      throw new Error("Duplicate tournament id.");
    }

    await assertCurrentLocks();
    const now = new Date();
    const stored: StoredTournament = {
      ...structuredClone(tournament),
      authorityToken: null,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.tournaments.set(tournament.tournamentId, stored);
    return structuredClone(stored);
  }

  async getTournament(
    tournamentId: string,
    includeDeleted = false,
  ): Promise<StoredTournament | null> {
    const t = this.tournaments.get(tournamentId);
    return t && (includeDeleted || !t.deletedAt) ? structuredClone(t) : null;
  }

  async saveTournament(tournament: StoredTournament): Promise<StoredTournament> {
    await assertCurrentLocks();
    const current = this.tournaments.get(tournament.tournamentId);
    if (
      !current ||
      (current.revision ?? 0) !== (tournament.revision ?? 0) ||
      (current.authorityToken ?? null) !== (tournament.authorityToken ?? null)
    ) {
      throw new Error("Tournament changed; reload before writing");
    }

    const updated: StoredTournament = {
      ...structuredClone(tournament),
      revision: (tournament.revision ?? 0) + 1,
      updatedAt: new Date(),
    };

    this.tournaments.set(tournament.tournamentId, updated);
    return structuredClone(updated);
  }

  async listPublicTournaments(options?: {
    status?: TournamentStatus;
  }): Promise<StoredTournament[]> {
    return Array.from(this.tournaments.values(), (t) => structuredClone(t))
      .filter((t) => !t.deletedAt)
      .filter((t) => {
        if (t.settings.visibility !== "public") return false;
        if (options?.status) {
          if (t.status !== options.status) return false;
        } else if (t.status === "cancelled") {
          // Hide cancelled tournaments from the default browse list.
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Featured first, then newest first.
        if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
  }

  async listAllTournaments(): Promise<StoredTournament[]> {
    return Array.from(this.tournaments.values(), (t) => structuredClone(t))
      .filter((t) => !t.deletedAt)
      .sort((a, b) => {
        if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
  }

  async countOngoingTournamentsByCreator(creatorId: string): Promise<number> {
    let count = 0;
    for (const t of this.tournaments.values()) {
      if (
        !t.deletedAt &&
        t.creatorId === creatorId &&
        ONGOING_TOURNAMENT_STATUSES.includes(t.status)
      ) {
        count += 1;
      }
    }
    return count;
  }

  async deleteTournament(tournamentId: string, expected?: StoredTournament): Promise<void> {
    await assertCurrentLocks();
    const current = this.tournaments.get(tournamentId);
    if (
      !expected ||
      expected.tournamentId !== tournamentId ||
      !current ||
      current.revision !== expected.revision ||
      current.authorityToken !== expected.authorityToken
    ) {
      throw new Error("Tournament changed; reload before deleting");
    }
    this.tournaments.set(tournamentId, {
      ...structuredClone(current),
      status: "cancelled",
      deletedAt: new Date(),
      name: "Deleted tournament",
      creatorId: "deleted",
      description: undefined,
      settings: { ...current.settings, inviteCode: undefined },
      registrationAbsences: [],
      participants: [],
      rounds: [],
      groups: [],
      knockoutRounds: [],
      invitedUserIds: [],
      featuredMatchId: null,
      isFeatured: false,
      revision: (current.revision ?? 0) + 1,
    });
  }

  async listRecoveryTournaments(after?: string, limit = 50): Promise<StoredTournament[]> {
    return Array.from(this.tournaments.values())
      .filter(
        (t) =>
          (!after || t.tournamentId > after) &&
          (t.status === "registration" ||
            t.status === "active" ||
            (t.status === "finished" && t.completionEffectsPending) ||
            t.status === "cancelled"),
      )
      .sort((a, b) => a.tournamentId.localeCompare(b.tournamentId))
      .slice(0, limit)
      .map((t) => structuredClone(t));
  }

  async listTournamentsForPlayer(playerId: string): Promise<StoredTournament[]> {
    return Array.from(this.tournaments.values(), (t) => structuredClone(t))
      .filter((t) => !t.deletedAt)
      .filter(
        (t) =>
          t.creatorId === playerId ||
          t.participants.some((p) => p.playerId === playerId) ||
          t.invitedUserIds.includes(playerId),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async listTournamentsForInvitedUser(playerId: string): Promise<StoredTournament[]> {
    return Array.from(this.tournaments.values(), (t) => structuredClone(t))
      .filter((t) => !t.deletedAt)
      .filter((t) => t.invitedUserIds.includes(playerId))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async findTournamentByMatchRoomId(roomId: string): Promise<StoredTournament | null> {
    for (const t of this.tournaments.values()) {
      for (const round of [...t.rounds, ...t.knockoutRounds]) {
        if (round.matches.some((m) => m.roomId === roomId)) return structuredClone(t);
      }
      for (const group of t.groups) {
        for (const round of group.rounds) {
          if (round.matches.some((m) => m.roomId === roomId)) return structuredClone(t);
        }
      }
    }
    return null;
  }

  async findRegistrationTournamentsByParticipant(playerId: string): Promise<StoredTournament[]> {
    return Array.from(this.tournaments.values(), (t) => structuredClone(t))
      .filter((t) => !t.deletedAt)
      .filter(
        (t) => t.status === "registration" && t.participants.some((p) => p.playerId === playerId),
      );
  }
}
