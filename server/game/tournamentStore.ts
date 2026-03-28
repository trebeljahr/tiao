import type {
  TournamentStatus,
  TournamentSettings,
  TournamentParticipant,
  TournamentRound,
  TournamentGroup,
} from "../../shared/src";
import Tournament from "../models/Tournament";

export type StoredTournament = {
  tournamentId: string;
  name: string;
  description?: string;
  creatorId: string;
  creatorDisplayName: string;
  status: TournamentStatus;
  settings: TournamentSettings;
  participants: TournamentParticipant[];
  rounds: TournamentRound[];
  groups: TournamentGroup[];
  knockoutRounds: TournamentRound[];
  featuredMatchId: string | null;
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
}

function toStoredTournament(doc: any): StoredTournament {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    tournamentId: obj.tournamentId,
    name: obj.name,
    description: obj.description,
    creatorId: obj.creatorId,
    creatorDisplayName: obj.creatorDisplayName,
    status: obj.status,
    settings: obj.settings,
    participants: obj.participants ?? [],
    rounds: obj.rounds ?? [],
    groups: obj.groups ?? [],
    knockoutRounds: obj.knockoutRounds ?? [],
    featuredMatchId: obj.featuredMatchId ?? null,
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
    }

    const docs = await Tournament.find(filter).sort({ createdAt: -1 }).limit(50).lean().exec();

    return docs.map(toStoredTournament);
  }

  async listTournamentsForPlayer(playerId: string): Promise<StoredTournament[]> {
    const docs = await Tournament.find({
      $or: [{ "participants.playerId": playerId }, { creatorId: playerId }],
    })
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
        if (options?.status && t.status !== options.status) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listTournamentsForPlayer(playerId: string): Promise<StoredTournament[]> {
    return Array.from(this.tournaments.values())
      .filter(
        (t) => t.creatorId === playerId || t.participants.some((p) => p.playerId === playerId),
      )
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
