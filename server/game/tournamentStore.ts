import type {
  TournamentStatus,
  TournamentSettings,
  TournamentParticipant,
  TournamentRound,
  TournamentGroup,
} from "../../shared/src";
import Tournament, { ITournament } from "../models/Tournament";

export type StoredTournament = {
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
  invitedUserIds: string[];
  createdAt: Date;
  updatedAt: Date;
};

export interface TournamentStore {
  createTournament(
    tournament: Omit<StoredTournament, "createdAt" | "updatedAt">,
  ): Promise<StoredTournament>;
  getTournament(tournamentId: string): Promise<StoredTournament | null>;
  saveTournament(tournament: StoredTournament): Promise<StoredTournament>;
  listPublicTournaments(options?: { status?: TournamentStatus }): Promise<StoredTournament[]>;
  listTournamentsForPlayer(playerId: string): Promise<StoredTournament[]>;
  findTournamentByMatchRoomId(roomId: string): Promise<StoredTournament | null>;
  findRegistrationTournamentsByParticipant(playerId: string): Promise<StoredTournament[]>;
  listTournamentsForInvitedUser(playerId: string): Promise<StoredTournament[]>;
  countOngoingTournamentsByCreator(creatorId: string): Promise<number>;
  deleteTournament(tournamentId: string): Promise<void>;
}

// Statuses considered "ongoing" for the per-creator limit.
export const ONGOING_TOURNAMENT_STATUSES: TournamentStatus[] = ["draft", "registration", "active"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toStoredTournament(
  doc: ITournament | StoredTournament | Record<string, any>,
): StoredTournament {
  const obj = "toObject" in doc && typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
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
    invitedUserIds: obj.invitedUserIds ?? [],
    createdAt: new Date(obj.createdAt),
    updatedAt: new Date(obj.updatedAt),
  };
}

export class MongoTournamentStore implements TournamentStore {
  async createTournament(
    tournament: Omit<StoredTournament, "createdAt" | "updatedAt">,
  ): Promise<StoredTournament> {
    const doc = await Tournament.create(tournament);
    return toStoredTournament(doc);
  }

  async getTournament(tournamentId: string): Promise<StoredTournament | null> {
    const doc = await Tournament.findOne({ tournamentId }).lean().exec();
    return doc ? toStoredTournament(doc) : null;
  }

  async saveTournament(tournament: StoredTournament): Promise<StoredTournament> {
    const doc = await Tournament.findOneAndUpdate(
      { tournamentId: tournament.tournamentId },
      {
        $set: {
          name: tournament.name,
          description: tournament.description,
          status: tournament.status,
          settings: tournament.settings,
          participants: tournament.participants,
          rounds: tournament.rounds,
          groups: tournament.groups,
          knockoutRounds: tournament.knockoutRounds,
          featuredMatchId: tournament.featuredMatchId,
          invitedUserIds: tournament.invitedUserIds,
        },
      },
      { new: true },
    )
      .lean()
      .exec();

    if (!doc) {
      throw new Error("Tournament not found.");
    }

    return toStoredTournament(doc);
  }

  async listPublicTournaments(options?: {
    status?: TournamentStatus;
  }): Promise<StoredTournament[]> {
    const filter: any = { "settings.visibility": "public" };
    if (options?.status) {
      filter.status = options.status;
    } else {
      // Hide cancelled tournaments from the public browse list by default.
      // Creators/participants still see them via listTournamentsForPlayer.
      filter.status = { $ne: "cancelled" };
    }

    const docs = await Tournament.find(filter).sort({ createdAt: -1 }).limit(50).lean().exec();

    return docs.map(toStoredTournament);
  }

  async countOngoingTournamentsByCreator(creatorId: string): Promise<number> {
    return Tournament.countDocuments({
      creatorId,
      status: { $in: ONGOING_TOURNAMENT_STATUSES },
    }).exec();
  }

  async deleteTournament(tournamentId: string): Promise<void> {
    await Tournament.deleteOne({ tournamentId }).exec();
  }

  async listTournamentsForPlayer(playerId: string): Promise<StoredTournament[]> {
    const docs = await Tournament.find({
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
    const docs = await Tournament.find({ invitedUserIds: playerId })
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

    const now = new Date();
    const stored: StoredTournament = {
      ...tournament,
      createdAt: now,
      updatedAt: now,
    };

    this.tournaments.set(tournament.tournamentId, stored);
    return { ...stored };
  }

  async getTournament(tournamentId: string): Promise<StoredTournament | null> {
    const t = this.tournaments.get(tournamentId);
    return t ? { ...t } : null;
  }

  async saveTournament(tournament: StoredTournament): Promise<StoredTournament> {
    if (!this.tournaments.has(tournament.tournamentId)) {
      throw new Error("Tournament not found.");
    }

    const updated: StoredTournament = {
      ...tournament,
      updatedAt: new Date(),
    };

    this.tournaments.set(tournament.tournamentId, updated);
    return { ...updated };
  }

  async listPublicTournaments(options?: {
    status?: TournamentStatus;
  }): Promise<StoredTournament[]> {
    return Array.from(this.tournaments.values())
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
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async countOngoingTournamentsByCreator(creatorId: string): Promise<number> {
    let count = 0;
    for (const t of this.tournaments.values()) {
      if (t.creatorId === creatorId && ONGOING_TOURNAMENT_STATUSES.includes(t.status)) {
        count += 1;
      }
    }
    return count;
  }

  async deleteTournament(tournamentId: string): Promise<void> {
    this.tournaments.delete(tournamentId);
  }

  async listTournamentsForPlayer(playerId: string): Promise<StoredTournament[]> {
    return Array.from(this.tournaments.values())
      .filter(
        (t) =>
          t.creatorId === playerId ||
          t.participants.some((p) => p.playerId === playerId) ||
          t.invitedUserIds.includes(playerId),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async listTournamentsForInvitedUser(playerId: string): Promise<StoredTournament[]> {
    return Array.from(this.tournaments.values())
      .filter((t) => t.invitedUserIds.includes(playerId))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async findTournamentByMatchRoomId(roomId: string): Promise<StoredTournament | null> {
    for (const t of this.tournaments.values()) {
      for (const round of [...t.rounds, ...t.knockoutRounds]) {
        if (round.matches.some((m) => m.roomId === roomId)) return { ...t };
      }
      for (const group of t.groups) {
        for (const round of group.rounds) {
          if (round.matches.some((m) => m.roomId === roomId)) return { ...t };
        }
      }
    }
    return null;
  }

  async findRegistrationTournamentsByParticipant(playerId: string): Promise<StoredTournament[]> {
    return Array.from(this.tournaments.values()).filter(
      (t) => t.status === "registration" && t.participants.some((p) => p.playerId === playerId),
    );
  }
}
