import type { TournamentMatch } from "../../shared/src";
import TournamentMatchModel from "../models/TournamentMatch";

export type StoredTournamentMatch = TournamentMatch;

export interface TournamentMatchStore {
  createMatches(tournamentId: string, matches: TournamentMatch[]): Promise<void>;
  findByTournament(tournamentId: string): Promise<TournamentMatch[]>;
  findByRoomId(roomId: string): Promise<(TournamentMatch & { tournamentId: string }) | null>;
  updateMatch(
    tournamentId: string,
    matchId: string,
    update: Partial<TournamentMatch>,
  ): Promise<TournamentMatch | null>;
  deleteByTournament(tournamentId: string): Promise<number>;
}

function toTournamentMatch(doc: Record<string, unknown>): TournamentMatch {
  return {
    matchId: doc.matchId as string,
    roundIndex: doc.roundIndex as number,
    matchIndex: doc.matchIndex as number,
    groupId: doc.groupId as string | undefined,
    players: doc.players as TournamentMatch["players"],
    roomId: (doc.roomId as string) ?? null,
    winner: (doc.winner as string) ?? null,
    score: (doc.score as [number, number]) ?? [0, 0],
    status: doc.status as TournamentMatch["status"],
    finishReason: doc.finishReason as TournamentMatch["finishReason"],
    historyLength: doc.historyLength as number | undefined,
    playerColors: doc.playerColors as TournamentMatch["playerColors"],
    scheduledAt: doc.scheduledAt as string | undefined,
    deadline: doc.deadline as string | undefined,
  };
}

export class MongoTournamentMatchStore implements TournamentMatchStore {
  async createMatches(tournamentId: string, matches: TournamentMatch[]): Promise<void> {
    if (matches.length === 0) return;
    const docs = matches.map((m) => ({ ...m, tournamentId }));
    await TournamentMatchModel.insertMany(docs, { ordered: false }).catch((err) => {
      // Ignore duplicate key errors (e.g. re-creating matches for the same round)
      if (err?.code !== 11000) throw err;
    });
  }

  async findByTournament(tournamentId: string): Promise<TournamentMatch[]> {
    const docs = await TournamentMatchModel.find({ tournamentId })
      .sort({ roundIndex: 1, matchIndex: 1 })
      .lean()
      .exec();
    return docs.map((d) => toTournamentMatch(d as Record<string, unknown>));
  }

  async findByRoomId(roomId: string): Promise<(TournamentMatch & { tournamentId: string }) | null> {
    const doc = (await TournamentMatchModel.findOne({ roomId }).lean().exec()) as Record<
      string,
      unknown
    > | null;
    if (!doc) return null;
    return {
      ...toTournamentMatch(doc),
      tournamentId: doc.tournamentId as string,
    };
  }

  async updateMatch(
    tournamentId: string,
    matchId: string,
    update: Partial<TournamentMatch>,
  ): Promise<TournamentMatch | null> {
    const doc = await TournamentMatchModel.findOneAndUpdate(
      { tournamentId, matchId },
      { $set: update },
      { new: true },
    )
      .lean()
      .exec();
    return doc ? toTournamentMatch(doc as Record<string, unknown>) : null;
  }

  async deleteByTournament(tournamentId: string): Promise<number> {
    const result = await TournamentMatchModel.deleteMany({ tournamentId });
    return result.deletedCount;
  }
}

export class InMemoryTournamentMatchStore implements TournamentMatchStore {
  private matches = new Map<string, TournamentMatch & { tournamentId: string }>();

  private key(tournamentId: string, matchId: string): string {
    return `${tournamentId}:${matchId}`;
  }

  async createMatches(tournamentId: string, matches: TournamentMatch[]): Promise<void> {
    for (const m of matches) {
      this.matches.set(this.key(tournamentId, m.matchId), { ...m, tournamentId });
    }
  }

  async findByTournament(tournamentId: string): Promise<TournamentMatch[]> {
    return Array.from(this.matches.values())
      .filter((m) => m.tournamentId === tournamentId)
      .sort((a, b) => a.roundIndex - b.roundIndex || a.matchIndex - b.matchIndex)
      .map(({ tournamentId: _tid, ...rest }) => rest);
  }

  async findByRoomId(roomId: string): Promise<(TournamentMatch & { tournamentId: string }) | null> {
    for (const m of this.matches.values()) {
      if (m.roomId === roomId) return { ...m };
    }
    return null;
  }

  async updateMatch(
    tournamentId: string,
    matchId: string,
    update: Partial<TournamentMatch>,
  ): Promise<TournamentMatch | null> {
    const k = this.key(tournamentId, matchId);
    const existing = this.matches.get(k);
    if (!existing) return null;
    const updated = { ...existing, ...update };
    this.matches.set(k, updated);
    const { tournamentId: _tid, ...rest } = updated;
    return rest;
  }

  async deleteByTournament(tournamentId: string): Promise<number> {
    let count = 0;
    for (const [key, m] of this.matches) {
      if (m.tournamentId === tournamentId) {
        this.matches.delete(key);
        count++;
      }
    }
    return count;
  }
}
