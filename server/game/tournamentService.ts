import type {
  PlayerIdentity,
  TournamentMatch,
  TournamentMatchPlayer,
  TournamentParticipant,
  TournamentRound,
  TournamentGroup,
  TournamentSettings,
  TournamentSnapshot,
  TournamentListItem,
  TournamentStatus,
} from "../../shared/src";
import { GameService, GameServiceError, TournamentGameCallback } from "./gameService";
import { LockProvider, InMemoryLockProvider } from "./lockProvider";
import { TournamentStore, StoredTournament, MongoTournamentStore } from "./tournamentStore";
import { getWinner, getFinishReason } from "../../shared/src";
import GameAccount from "../models/GameAccount";

// ── Helpers ──

const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateTournamentId(): string {
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  }
  return id;
}

function generateMatchId(roundIndex: number, matchIndex: number, prefix = ""): string {
  return `${prefix}R${roundIndex}M${matchIndex}`;
}

type PlayerProfile = { displayName: string; profilePicture?: string };

async function fetchPlayerProfiles(playerIds: string[]): Promise<Map<string, PlayerProfile>> {
  const map = new Map<string, PlayerProfile>();
  if (playerIds.length === 0) return map;
  try {
    const accounts = await GameAccount.find(
      { _id: { $in: playerIds } },
      { displayName: 1, profilePicture: 1 },
    )
      .lean()
      .exec();
    for (const a of accounts) {
      map.set(String(a._id), { displayName: a.displayName, profilePicture: a.profilePicture });
    }
  } catch {
    // Graceful fallback when DB is unavailable (e.g. in-memory test stores)
  }
  return map;
}

function participantToMatchPlayer(p: TournamentParticipant): TournamentMatchPlayer {
  return { playerId: p.playerId, displayName: p.displayName, seed: p.seed };
}

// ── Bracket Generation: Round Robin (circle method) ──

function generateRoundRobinRounds(
  participants: TournamentParticipant[],
  prefix = "",
): TournamentRound[] {
  const players = [...participants];
  const hasBye = players.length % 2 !== 0;
  if (hasBye) {
    // Add a dummy "bye" participant
    players.push(null as any);
  }

  const n = players.length;
  const totalRounds = n - 1;
  const rounds: TournamentRound[] = [];

  // Circle method: fix players[0], rotate the rest
  const rotating = players.slice(1);

  for (let r = 0; r < totalRounds; r++) {
    const matches: TournamentMatch[] = [];
    const roundPlayers = [players[0], ...rotating];

    for (let m = 0; m < n / 2; m++) {
      const p1 = roundPlayers[m];
      const p2 = roundPlayers[n - 1 - m];

      const isBye = !p1 || !p2;
      matches.push({
        matchId: generateMatchId(r, m, prefix),
        roundIndex: r,
        matchIndex: m,
        players: [
          p1 ? participantToMatchPlayer(p1) : null,
          p2 ? participantToMatchPlayer(p2) : null,
        ],
        roomId: null,
        winner: isBye ? (p1?.playerId ?? p2?.playerId ?? null) : null,
        score: [0, 0],
        status: isBye ? "bye" : "pending",
      });
    }

    rounds.push({
      roundIndex: r,
      label: `Round ${r + 1}`,
      matches,
      status: "pending",
    });

    // Rotate: move last element to position 1
    rotating.unshift(rotating.pop()!);
  }

  return rounds;
}

// ── Bracket Generation: Single Elimination ──

function nextPowerOf2(n: number): number {
  let v = 1;
  while (v < n) v *= 2;
  return v;
}

function getRoundLabel(roundIndex: number, totalRounds: number): string {
  const remaining = totalRounds - roundIndex;
  if (remaining === 1) return "Final";
  if (remaining === 2) return "Semifinal";
  if (remaining === 3) return "Quarterfinal";
  return `Round ${roundIndex + 1}`;
}

function generateSingleEliminationRounds(participants: TournamentParticipant[]): TournamentRound[] {
  const size = nextPowerOf2(participants.length);
  const totalRounds = Math.log2(size);
  const rounds: TournamentRound[] = [];

  // Sort by seed for bracket positioning
  const seeded = [...participants].sort((a, b) => a.seed - b.seed);

  // First round: seed 1 vs seed N, seed 2 vs N-1, etc.
  // Fill with byes for missing players
  const firstRoundMatches: TournamentMatch[] = [];
  for (let m = 0; m < size / 2; m++) {
    const topSeedIdx = m;
    const bottomSeedIdx = size - 1 - m;
    const p1 = seeded[topSeedIdx] ?? null;
    const p2 = seeded[bottomSeedIdx] ?? null;

    const isBye = !p1 || !p2;
    firstRoundMatches.push({
      matchId: generateMatchId(0, m),
      roundIndex: 0,
      matchIndex: m,
      players: [p1 ? participantToMatchPlayer(p1) : null, p2 ? participantToMatchPlayer(p2) : null],
      roomId: null,
      winner: isBye ? (p1?.playerId ?? p2?.playerId ?? null) : null,
      score: [0, 0],
      status: isBye ? "bye" : "pending",
    });
  }

  rounds.push({
    roundIndex: 0,
    label: getRoundLabel(0, totalRounds),
    matches: firstRoundMatches,
    status: "pending",
  });

  // Subsequent rounds: placeholders
  for (let r = 1; r < totalRounds; r++) {
    const matchCount = size / Math.pow(2, r + 1);
    const matches: TournamentMatch[] = [];
    for (let m = 0; m < matchCount; m++) {
      matches.push({
        matchId: generateMatchId(r, m),
        roundIndex: r,
        matchIndex: m,
        players: [null, null],
        roomId: null,
        winner: null,
        score: [0, 0],
        status: "pending",
      });
    }

    rounds.push({
      roundIndex: r,
      label: getRoundLabel(r, totalRounds),
      matches,
      status: "pending",
    });
  }

  return rounds;
}

// ── Bracket Generation: Groups + Knockout ──

function generateGroups(
  participants: TournamentParticipant[],
  groupSize: number,
): TournamentGroup[] {
  const seeded = [...participants].sort((a, b) => a.seed - b.seed);
  const numGroups = Math.ceil(seeded.length / groupSize);
  const groups: TournamentGroup[] = [];

  for (let g = 0; g < numGroups; g++) {
    groups.push({
      groupId: `G${g}`,
      label: `Group ${String.fromCharCode(65 + g)}`,
      participantIds: [],
      rounds: [],
      standings: [],
    });
  }

  // Snake-seed distribution
  for (let i = 0; i < seeded.length; i++) {
    const row = Math.floor(i / numGroups);
    const col = i % numGroups;
    const groupIdx = row % 2 === 0 ? col : numGroups - 1 - col;
    groups[groupIdx].participantIds.push(seeded[i].playerId);
  }

  // Generate round-robin within each group
  for (const group of groups) {
    const groupParticipants = group.participantIds
      .map((id) => participants.find((p) => p.playerId === id)!)
      .filter(Boolean);

    group.rounds = generateRoundRobinRounds(groupParticipants, `${group.groupId}-`);

    // Tag matches with groupId
    for (const round of group.rounds) {
      for (const match of round.matches) {
        match.groupId = group.groupId;
      }
    }

    // Initialize standings
    group.standings = groupParticipants.map((p) => ({
      playerId: p.playerId,
      displayName: p.displayName,
      seed: p.seed,
      wins: 0,
      losses: 0,
      draws: 0,
      points: 0,
      scoreDiff: 0,
    }));
  }

  return groups;
}

// ── Service ──

export class TournamentService implements TournamentGameCallback {
  constructor(
    private readonly store: TournamentStore = new MongoTournamentStore(),
    private readonly gameService: GameService,
    private readonly lockProvider: LockProvider = new InMemoryLockProvider(),
  ) {
    // Wire up the callback so GameService notifies us on game completion
    this.gameService.setTournamentService(this);

    // Auto-drop players from registration-phase tournaments when they disconnect
    this.gameService.onLobbyDisconnect((playerId) => {
      void this.handleLobbyDisconnect(playerId);
    });
  }

  private async handleLobbyDisconnect(playerId: string): Promise<void> {
    const tournaments = await this.store.findRegistrationTournamentsByParticipant(playerId);
    for (const t of tournaments) {
      try {
        await this.unregisterPlayer(t.tournamentId, playerId);
      } catch {
        // Best-effort: player may have already been unregistered
      }
    }
  }

  // ── Lifecycle ──

  async createTournament(
    creator: PlayerIdentity,
    settings: TournamentSettings,
    name: string,
    description?: string,
  ): Promise<StoredTournament> {
    if (creator.kind !== "account") {
      throw new GameServiceError(
        403,
        "ACCOUNT_REQUIRED",
        "Only account users can create tournaments.",
      );
    }

    const tournamentId = generateTournamentId();
    return this.store.createTournament({
      tournamentId,
      name,
      description,
      creatorId: creator.playerId,
      creatorDisplayName: creator.displayName,
      status: "registration",
      settings,
      participants: [],
      rounds: [],
      groups: [],
      knockoutRounds: [],
      featuredMatchId: null,
    });
  }

  async registerPlayer(
    tournamentId: string,
    player: PlayerIdentity,
    inviteCode?: string,
  ): Promise<StoredTournament> {
    if (player.kind !== "account") {
      throw new GameServiceError(
        403,
        "ACCOUNT_REQUIRED",
        "Only account users can join tournaments.",
      );
    }

    return this.withLock(tournamentId, async () => {
      const tournament = await this.getTournament(tournamentId);

      if (tournament.status !== "registration") {
        throw new GameServiceError(409, "REGISTRATION_CLOSED", "Registration is not open.");
      }

      if (tournament.participants.some((p) => p.playerId === player.playerId)) {
        throw new GameServiceError(409, "ALREADY_REGISTERED", "You are already registered.");
      }

      if (tournament.participants.length >= tournament.settings.maxPlayers) {
        throw new GameServiceError(409, "TOURNAMENT_FULL", "Tournament is full.");
      }

      if (
        tournament.settings.visibility === "private" &&
        tournament.settings.inviteCode &&
        inviteCode !== tournament.settings.inviteCode
      ) {
        throw new GameServiceError(403, "INVALID_INVITE_CODE", "Invalid invite code.");
      }

      tournament.participants.push({
        playerId: player.playerId,
        displayName: player.displayName,
        seed: tournament.participants.length + 1,
        status: "registered",
      });

      const saved = await this.store.saveTournament(tournament);
      this.broadcastTournamentUpdate(saved);
      return saved;
    });
  }

  async unregisterPlayer(tournamentId: string, playerId: string): Promise<StoredTournament> {
    return this.withLock(tournamentId, async () => {
      const tournament = await this.getTournament(tournamentId);

      if (tournament.status !== "registration") {
        throw new GameServiceError(
          409,
          "REGISTRATION_CLOSED",
          "Cannot unregister after registration closes.",
        );
      }

      const idx = tournament.participants.findIndex((p) => p.playerId === playerId);
      if (idx === -1) {
        throw new GameServiceError(404, "NOT_REGISTERED", "You are not registered.");
      }

      tournament.participants.splice(idx, 1);

      // Re-number seeds
      tournament.participants.forEach((p, i) => {
        p.seed = i + 1;
      });

      const saved = await this.store.saveTournament(tournament);
      this.broadcastTournamentUpdate(saved);
      return saved;
    });
  }

  async startTournament(tournamentId: string, adminId: string): Promise<StoredTournament> {
    return this.withLock(tournamentId, async () => {
      const tournament = await this.getTournament(tournamentId);

      if (tournament.creatorId !== adminId) {
        throw new GameServiceError(403, "NOT_ADMIN", "Only the tournament creator can start it.");
      }

      if (tournament.status !== "registration") {
        throw new GameServiceError(
          409,
          "INVALID_STATUS",
          "Tournament cannot be started from its current state.",
        );
      }

      if (tournament.participants.length < tournament.settings.minPlayers) {
        throw new GameServiceError(
          409,
          "NOT_ENOUGH_PLAYERS",
          `Need at least ${tournament.settings.minPlayers} players to start.`,
        );
      }

      // Mark all participants as active
      for (const p of tournament.participants) {
        p.status = "active";
      }

      // Generate bracket based on format
      switch (tournament.settings.format) {
        case "round-robin":
          tournament.rounds = generateRoundRobinRounds(tournament.participants);
          break;
        case "single-elimination":
          tournament.rounds = generateSingleEliminationRounds(tournament.participants);
          break;
        case "groups-knockout": {
          const groupSize = tournament.settings.groupSize ?? 4;
          tournament.groups = generateGroups(tournament.participants, groupSize);
          break;
        }
      }

      // Activate the first round
      if (tournament.rounds.length > 0) {
        tournament.rounds[0].status = "active";
      }
      for (const group of tournament.groups) {
        if (group.rounds.length > 0) {
          group.rounds[0].status = "active";
        }
      }

      tournament.status = "active";
      const saved = await this.store.saveTournament(tournament);

      // Create GameRooms for the first round
      await this.createRoomsForActiveRound(saved);

      this.broadcastTournamentUpdate(saved);
      return saved;
    });
  }

  async cancelTournament(tournamentId: string, adminId: string): Promise<StoredTournament> {
    return this.withLock(tournamentId, async () => {
      const tournament = await this.getTournament(tournamentId);

      if (tournament.creatorId !== adminId) {
        throw new GameServiceError(403, "NOT_ADMIN", "Only the tournament creator can cancel it.");
      }

      if (tournament.status === "finished" || tournament.status === "cancelled") {
        throw new GameServiceError(
          409,
          "ALREADY_DONE",
          "Tournament is already finished or cancelled.",
        );
      }

      tournament.status = "cancelled";
      const saved = await this.store.saveTournament(tournament);
      this.broadcastTournamentUpdate(saved);
      return saved;
    });
  }

  // ── Seeding ──

  async updateSeeding(
    tournamentId: string,
    adminId: string,
    seeds: { playerId: string; seed: number }[],
  ): Promise<StoredTournament> {
    return this.withLock(tournamentId, async () => {
      const tournament = await this.getTournament(tournamentId);
      this.ensureAdmin(tournament, adminId);

      if (tournament.status !== "registration") {
        throw new GameServiceError(
          409,
          "INVALID_STATUS",
          "Seeds can only be changed during registration.",
        );
      }

      for (const entry of seeds) {
        const p = tournament.participants.find((pp) => pp.playerId === entry.playerId);
        if (p) p.seed = entry.seed;
      }

      const saved = await this.store.saveTournament(tournament);
      this.broadcastTournamentUpdate(saved);
      return saved;
    });
  }

  async randomizeSeeding(tournamentId: string, adminId: string): Promise<StoredTournament> {
    return this.withLock(tournamentId, async () => {
      const tournament = await this.getTournament(tournamentId);
      this.ensureAdmin(tournament, adminId);

      if (tournament.status !== "registration") {
        throw new GameServiceError(
          409,
          "INVALID_STATUS",
          "Seeds can only be changed during registration.",
        );
      }

      // Fisher-Yates shuffle
      const arr = tournament.participants;
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      arr.forEach((p, i) => {
        p.seed = i + 1;
      });

      const saved = await this.store.saveTournament(tournament);
      this.broadcastTournamentUpdate(saved);
      return saved;
    });
  }

  // ── Featured Match ──

  async setFeaturedMatch(
    tournamentId: string,
    adminId: string,
    matchId: string | null,
  ): Promise<StoredTournament> {
    return this.withLock(tournamentId, async () => {
      const tournament = await this.getTournament(tournamentId);
      this.ensureAdmin(tournament, adminId);

      tournament.featuredMatchId = matchId;
      const saved = await this.store.saveTournament(tournament);
      this.broadcastTournamentUpdate(saved);
      return saved;
    });
  }

  // ── Match Forfeit (admin) ──

  async forfeitMatch(
    tournamentId: string,
    matchId: string,
    loserId: string,
    adminId: string,
  ): Promise<StoredTournament> {
    return this.withLock(tournamentId, async () => {
      const tournament = await this.getTournament(tournamentId);
      this.ensureAdmin(tournament, adminId);

      const match = this.findMatch(tournament, matchId);
      if (!match) {
        throw new GameServiceError(404, "MATCH_NOT_FOUND", "Match not found.");
      }

      if (match.status === "finished" || match.status === "forfeit" || match.status === "bye") {
        throw new GameServiceError(409, "MATCH_ALREADY_DONE", "Match is already completed.");
      }

      const winnerId = match.players.find((p) => p && p.playerId !== loserId)?.playerId ?? null;
      match.winner = winnerId;
      match.status = "forfeit";

      // Eliminate the loser in single-elimination
      if (tournament.settings.format === "single-elimination") {
        const loser = tournament.participants.find((p) => p.playerId === loserId);
        if (loser) loser.status = "eliminated";
      }

      this.checkRoundAdvancement(tournament);
      const saved = await this.store.saveTournament(tournament);
      await this.createRoomsForActiveRound(saved);
      this.broadcastTournamentUpdate(saved);
      return saved;
    });
  }

  // ── Game Completion Callback ──

  async onGameCompleted(roomId: string): Promise<void> {
    const tournament = await this.store.findTournamentByMatchRoomId(roomId);
    if (!tournament) return;

    await this.withLock(tournament.tournamentId, async () => {
      // Re-fetch inside lock
      const t = await this.getTournament(tournament.tournamentId);

      const match = this.findMatchByRoomId(t, roomId);
      if (!match || match.status === "finished" || match.status === "forfeit") return;

      // Get room to determine winner
      const room = await this.gameService.getSnapshot(roomId);
      if (room.status !== "finished") return;

      const winner = getWinner(room.state);
      if (!winner) return;

      // Map color-based winner to playerId
      const winnerSeat = room.seats[winner];
      if (!winnerSeat) return;

      match.winner = winnerSeat.player.playerId;
      match.status = "finished";

      // Update score aligned to player slots (not color slots)
      const p0Color = match.playerColors?.[0] ?? "white";
      const p1Color = match.playerColors?.[1] ?? "black";
      match.score = [room.state.score[p0Color], room.state.score[p1Color]];
      match.finishReason = getFinishReason(room.state);
      match.historyLength = room.state.history.length;

      // Update group standings if applicable
      if (match.groupId) {
        this.updateGroupStandings(t, match);
      }

      // Mark loser as eliminated in single-elimination
      if (t.settings.format === "single-elimination") {
        const loserId = match.players.find((p) => p && p.playerId !== match.winner)?.playerId;
        if (loserId) {
          const loser = t.participants.find((p) => p.playerId === loserId);
          if (loser) loser.status = "eliminated";
        }
      }

      this.checkRoundAdvancement(t);
      const saved = await this.store.saveTournament(t);
      await this.createRoomsForActiveRound(saved);
      this.broadcastTournamentUpdate(saved);
    });
  }

  // ── Queries ──

  async getTournamentSnapshot(tournamentId: string): Promise<TournamentSnapshot> {
    const t = await this.getTournament(tournamentId);
    return this.toSnapshot(t);
  }

  async listPublicTournaments(status?: TournamentStatus): Promise<TournamentListItem[]> {
    const tournaments = await this.store.listPublicTournaments(status ? { status } : undefined);
    return tournaments.map(this.toListItem);
  }

  async listMyTournaments(playerId: string): Promise<TournamentListItem[]> {
    const tournaments = await this.store.listTournamentsForPlayer(playerId);
    return tournaments.map(this.toListItem);
  }

  // ── Private Helpers ──

  private async getTournament(tournamentId: string): Promise<StoredTournament> {
    const t = await this.store.getTournament(tournamentId);
    if (!t) {
      throw new GameServiceError(404, "TOURNAMENT_NOT_FOUND", "Tournament not found.");
    }
    return t;
  }

  private ensureAdmin(tournament: StoredTournament, adminId: string): void {
    if (tournament.creatorId !== adminId) {
      throw new GameServiceError(403, "NOT_ADMIN", "Only the tournament creator can do this.");
    }
  }

  private findMatch(tournament: StoredTournament, matchId: string): TournamentMatch | null {
    for (const round of [...tournament.rounds, ...tournament.knockoutRounds]) {
      const match = round.matches.find((m) => m.matchId === matchId);
      if (match) return match;
    }
    for (const group of tournament.groups) {
      for (const round of group.rounds) {
        const match = round.matches.find((m) => m.matchId === matchId);
        if (match) return match;
      }
    }
    return null;
  }

  private findMatchByRoomId(tournament: StoredTournament, roomId: string): TournamentMatch | null {
    for (const round of [...tournament.rounds, ...tournament.knockoutRounds]) {
      const match = round.matches.find((m) => m.roomId === roomId);
      if (match) return match;
    }
    for (const group of tournament.groups) {
      for (const round of group.rounds) {
        const match = round.matches.find((m) => m.roomId === roomId);
        if (match) return match;
      }
    }
    return null;
  }

  private checkRoundAdvancement(tournament: StoredTournament): void {
    switch (tournament.settings.format) {
      case "round-robin":
        this.advanceRoundRobin(tournament);
        break;
      case "single-elimination":
        this.advanceSingleElimination(tournament);
        break;
      case "groups-knockout":
        this.advanceGroupsKnockout(tournament);
        break;
    }
  }

  private advanceRoundRobin(tournament: StoredTournament): void {
    for (const round of tournament.rounds) {
      if (round.status === "active") {
        const allDone = round.matches.every(
          (m) => m.status === "finished" || m.status === "forfeit" || m.status === "bye",
        );
        if (allDone) {
          round.status = "finished";

          // Notify round complete
          this.broadcastRoundComplete(tournament, round.roundIndex);
        }
      }
    }

    // Activate next pending round
    const nextPending = tournament.rounds.find((r) => r.status === "pending");
    if (nextPending) {
      nextPending.status = "active";
    } else {
      // All rounds done — tournament finished
      this.finishTournament(tournament);
    }
  }

  private advanceSingleElimination(tournament: StoredTournament): void {
    for (let r = 0; r < tournament.rounds.length; r++) {
      const round = tournament.rounds[r];
      if (round.status !== "active") continue;

      const allDone = round.matches.every(
        (m) => m.status === "finished" || m.status === "forfeit" || m.status === "bye",
      );
      if (!allDone) continue;

      round.status = "finished";
      this.broadcastRoundComplete(tournament, r);

      // Populate next round
      const nextRound = tournament.rounds[r + 1];
      if (nextRound) {
        for (let m = 0; m < round.matches.length; m += 2) {
          const winner1 = this.getMatchWinnerAsPlayer(tournament, round.matches[m]);
          const winner2 = round.matches[m + 1]
            ? this.getMatchWinnerAsPlayer(tournament, round.matches[m + 1])
            : null;

          const nextMatchIdx = Math.floor(m / 2);
          const nextMatch = nextRound.matches[nextMatchIdx];
          if (nextMatch) {
            nextMatch.players = [winner1, winner2];
            // If one player is null (shouldn't happen in correct brackets), it's a bye
            if (!winner1 || !winner2) {
              nextMatch.status = "bye";
              nextMatch.winner = (winner1 ?? winner2)?.playerId ?? null;
            }
          }
        }
        nextRound.status = "active";
      } else {
        // Final round done
        this.finishTournament(tournament);
      }
    }
  }

  private advanceGroupsKnockout(tournament: StoredTournament): void {
    let allGroupsDone = true;

    for (const group of tournament.groups) {
      for (const round of group.rounds) {
        if (round.status === "active") {
          const allDone = round.matches.every(
            (m) => m.status === "finished" || m.status === "forfeit" || m.status === "bye",
          );
          if (allDone) {
            round.status = "finished";
          }
        }
      }

      // Activate next pending round in group
      const nextPending = group.rounds.find((r) => r.status === "pending");
      if (nextPending) {
        nextPending.status = "active";
        allGroupsDone = false;
      } else if (group.rounds.some((r) => r.status === "active")) {
        allGroupsDone = false;
      }
    }

    // If all groups done and no knockout rounds yet, generate knockout
    if (allGroupsDone && tournament.knockoutRounds.length === 0 && tournament.groups.length > 0) {
      this.generateKnockoutFromGroups(tournament);
    }

    // Advance knockout rounds
    if (tournament.knockoutRounds.length > 0) {
      // Reuse single-elimination logic on knockoutRounds
      for (let r = 0; r < tournament.knockoutRounds.length; r++) {
        const round = tournament.knockoutRounds[r];
        if (round.status !== "active") continue;

        const allDone = round.matches.every(
          (m) => m.status === "finished" || m.status === "forfeit" || m.status === "bye",
        );
        if (!allDone) continue;

        round.status = "finished";

        const nextRound = tournament.knockoutRounds[r + 1];
        if (nextRound) {
          for (let m = 0; m < round.matches.length; m += 2) {
            const w1 = this.getMatchWinnerAsPlayer(tournament, round.matches[m]);
            const w2 = round.matches[m + 1]
              ? this.getMatchWinnerAsPlayer(tournament, round.matches[m + 1])
              : null;
            const nextMatch = nextRound.matches[Math.floor(m / 2)];
            if (nextMatch) {
              nextMatch.players = [w1, w2];
              if (!w1 || !w2) {
                nextMatch.status = "bye";
                nextMatch.winner = (w1 ?? w2)?.playerId ?? null;
              }
            }
          }
          nextRound.status = "active";
        } else {
          this.finishTournament(tournament);
        }
      }
    }
  }

  private generateKnockoutFromGroups(tournament: StoredTournament): void {
    const advancePerGroup =
      tournament.settings.advancePerGroup ?? Math.ceil((tournament.settings.groupSize ?? 4) / 2);

    // Compute final standings per group
    for (const group of tournament.groups) {
      this.computeGroupStandings(group, tournament);
    }

    // Collect advancing players from each group
    const advancingPlayers: TournamentParticipant[] = [];
    for (const group of tournament.groups) {
      const topPlayers = group.standings
        .slice(0, advancePerGroup)
        .map((s) => tournament.participants.find((p) => p.playerId === s.playerId)!)
        .filter(Boolean);
      advancingPlayers.push(...topPlayers);
    }

    // Eliminate non-advancing players
    for (const p of tournament.participants) {
      if (!advancingPlayers.some((a) => a.playerId === p.playerId)) {
        p.status = "eliminated";
      }
    }

    // Generate single-elimination bracket from advancing players
    // Seed them by group standings (1st from each group, then 2nd, etc.)
    advancingPlayers.forEach((p, i) => {
      p.seed = i + 1;
    });

    tournament.knockoutRounds = generateSingleEliminationRounds(advancingPlayers);
    // Relabel knockout rounds
    const totalKo = tournament.knockoutRounds.length;
    for (const round of tournament.knockoutRounds) {
      round.label = getRoundLabel(round.roundIndex, totalKo);
      // Prefix match IDs to avoid collision with group match IDs
      for (const match of round.matches) {
        match.matchId = `KO-${match.matchId}`;
      }
    }

    // Activate first knockout round
    if (tournament.knockoutRounds.length > 0) {
      tournament.knockoutRounds[0].status = "active";
    }
  }

  private computeGroupStandings(group: TournamentGroup, _tournament: StoredTournament): void {
    // Reset standings
    for (const s of group.standings) {
      s.wins = 0;
      s.losses = 0;
      s.draws = 0;
      s.points = 0;
      s.scoreDiff = 0;
    }

    for (const round of group.rounds) {
      for (const match of round.matches) {
        if (match.status !== "finished" && match.status !== "forfeit") continue;
        if (!match.players[0] || !match.players[1]) continue;

        const s1 = group.standings.find((s) => s.playerId === match.players[0]!.playerId);
        const s2 = group.standings.find((s) => s.playerId === match.players[1]!.playerId);
        if (!s1 || !s2) continue;

        if (match.winner === s1.playerId) {
          s1.wins++;
          s1.points += 3;
          s2.losses++;
          s1.scoreDiff += match.score[0] - match.score[1];
          s2.scoreDiff += match.score[1] - match.score[0];
        } else if (match.winner === s2.playerId) {
          s2.wins++;
          s2.points += 3;
          s1.losses++;
          s1.scoreDiff += match.score[0] - match.score[1];
          s2.scoreDiff += match.score[1] - match.score[0];
        } else {
          s1.draws++;
          s2.draws++;
          s1.points += 1;
          s2.points += 1;
        }
      }
    }

    // Sort by points desc, then score diff desc
    group.standings.sort((a, b) => b.points - a.points || b.scoreDiff - a.scoreDiff);
  }

  private updateGroupStandings(tournament: StoredTournament, match: TournamentMatch): void {
    const group = tournament.groups.find((g) => g.groupId === match.groupId);
    if (group) {
      this.computeGroupStandings(group, tournament);
    }
  }

  private getMatchWinnerAsPlayer(
    tournament: StoredTournament,
    match: TournamentMatch,
  ): TournamentMatchPlayer | null {
    if (!match.winner) return null;
    const participant = tournament.participants.find((p) => p.playerId === match.winner);
    if (!participant) return null;
    return participantToMatchPlayer(participant);
  }

  private finishTournament(tournament: StoredTournament): void {
    tournament.status = "finished";

    // Determine winner
    if (tournament.settings.format === "round-robin") {
      // Player with most wins (simple — could be refined with tiebreakers)
      const stats = new Map<string, number>();
      for (const round of tournament.rounds) {
        for (const match of round.matches) {
          if (match.winner) {
            stats.set(match.winner, (stats.get(match.winner) ?? 0) + 1);
          }
        }
      }
      let bestId = "";
      let bestWins = -1;
      for (const [id, wins] of stats) {
        if (wins > bestWins) {
          bestId = id;
          bestWins = wins;
        }
      }
      if (bestId) {
        const winner = tournament.participants.find((p) => p.playerId === bestId);
        if (winner) winner.status = "winner";
      }
    } else {
      // Elimination formats: find the last standing player
      const rounds =
        tournament.knockoutRounds.length > 0 ? tournament.knockoutRounds : tournament.rounds;
      const finalRound = rounds[rounds.length - 1];
      const finalMatch = finalRound?.matches[0];
      if (finalMatch?.winner) {
        const winner = tournament.participants.find((p) => p.playerId === finalMatch.winner);
        if (winner) winner.status = "winner";
      }
    }

    // Mark remaining active players as eliminated (except winner)
    for (const p of tournament.participants) {
      if (p.status === "active") {
        p.status = "eliminated";
      }
    }
  }

  private async createRoomsForActiveRound(tournament: StoredTournament): Promise<void> {
    const allRounds = [...tournament.rounds, ...tournament.knockoutRounds];

    // Also include group rounds
    for (const group of tournament.groups) {
      allRounds.push(...group.rounds);
    }

    // Collect player IDs that need rooms and fetch fresh profiles
    const playerIds = new Set<string>();
    for (const round of allRounds) {
      if (round.status !== "active") continue;
      for (const match of round.matches) {
        if (match.status !== "pending" || match.roomId) continue;
        if (match.players[0]) playerIds.add(match.players[0].playerId);
        if (match.players[1]) playerIds.add(match.players[1].playerId);
      }
    }
    const profiles = await fetchPlayerProfiles([...playerIds]);

    for (const round of allRounds) {
      if (round.status !== "active") continue;

      for (const match of round.matches) {
        if (match.status !== "pending") continue;
        if (match.roomId) continue;
        if (!match.players[0] || !match.players[1]) continue;

        const p0 = match.players[0];
        const p1 = match.players[1];
        const prof1 = profiles.get(p0.playerId);
        const prof2 = profiles.get(p1.playerId);

        try {
          const identity1: PlayerIdentity = {
            playerId: p0.playerId,
            displayName: prof1?.displayName ?? p0.displayName,
            kind: "account",
            profilePicture: prof1?.profilePicture,
          };
          const identity2: PlayerIdentity = {
            playerId: p1.playerId,
            displayName: prof2?.displayName ?? p1.displayName,
            kind: "account",
            profilePicture: prof2?.profilePicture,
          };

          const room = await this.gameService.createTournamentGame(
            identity1,
            identity2,
            tournament.settings.timeControl,
            tournament.tournamentId,
            match.matchId,
          );

          match.roomId = room.id;
          match.status = "active";

          // Record which color each player was assigned
          const p0Id = match.players[0].playerId;
          match.playerColors = [
            room.seats.white?.playerId === p0Id ? "white" : "black",
            room.seats.white?.playerId === p0Id ? "black" : "white",
          ];

          // Notify players that their match is ready
          this.gameService.broadcastLobby(match.players[0].playerId, {
            type: "tournament-match-ready",
            tournamentId: tournament.tournamentId,
            matchId: match.matchId,
            roomId: room.id,
          });
          this.gameService.broadcastLobby(match.players[1].playerId, {
            type: "tournament-match-ready",
            tournamentId: tournament.tournamentId,
            matchId: match.matchId,
            roomId: room.id,
          });
        } catch (err) {
          console.error(`[tournament] Failed to create game room for match ${match.matchId}:`, err);
        }
      }
    }

    // Save updated match roomIds and statuses
    await this.store.saveTournament(tournament);
  }

  // ── Broadcasting ──

  private broadcastTournamentUpdate(tournament: StoredTournament): void {
    for (const p of tournament.participants) {
      this.gameService.broadcastLobby(p.playerId, {
        type: "tournament-update",
        tournamentId: tournament.tournamentId,
      });
    }
    // Also notify creator
    this.gameService.broadcastLobby(tournament.creatorId, {
      type: "tournament-update",
      tournamentId: tournament.tournamentId,
    });
  }

  private broadcastRoundComplete(tournament: StoredTournament, roundIndex: number): void {
    for (const p of tournament.participants) {
      this.gameService.broadcastLobby(p.playerId, {
        type: "tournament-round-complete",
        tournamentId: tournament.tournamentId,
        roundIndex,
      });
    }
  }

  // ── Serialization ──

  private async toSnapshot(t: StoredTournament): Promise<TournamentSnapshot> {
    // Collect all unique player IDs across participants, matches, and standings
    const playerIds = new Set<string>();
    for (const p of t.participants) playerIds.add(p.playerId);
    const collectFromRounds = (rounds: TournamentRound[]) => {
      for (const round of rounds) {
        for (const match of round.matches) {
          for (const mp of match.players) {
            if (mp) playerIds.add(mp.playerId);
          }
        }
      }
    };
    collectFromRounds(t.rounds);
    collectFromRounds(t.knockoutRounds);
    for (const group of t.groups) {
      collectFromRounds(group.rounds);
      for (const s of group.standings) playerIds.add(s.playerId);
    }

    // Batch-fetch fresh profiles
    const profiles = await fetchPlayerProfiles([...playerIds]);
    const enrich = (id: string, fallbackName: string) => {
      const p = profiles.get(id);
      return { displayName: p?.displayName ?? fallbackName, profilePicture: p?.profilePicture };
    };

    // Enrich participants
    const participants: TournamentParticipant[] = t.participants.map((p) => ({
      ...p,
      ...enrich(p.playerId, p.displayName),
    }));

    // Enrich match players in rounds
    const enrichRounds = (rounds: TournamentRound[]): TournamentRound[] =>
      rounds.map((round) => ({
        ...round,
        matches: round.matches.map((match) => ({
          ...match,
          players: match.players.map((mp) =>
            mp ? { ...mp, ...enrich(mp.playerId, mp.displayName) } : null,
          ) as TournamentMatch["players"],
        })),
      }));

    // Enrich groups
    const groups: TournamentGroup[] = t.groups.map((group) => ({
      ...group,
      rounds: enrichRounds(group.rounds),
      standings: group.standings.map((s) => ({
        ...s,
        ...enrich(s.playerId, s.displayName),
      })),
    }));

    return {
      tournamentId: t.tournamentId,
      name: t.name,
      description: t.description,
      creatorId: t.creatorId,
      status: t.status,
      settings: t.settings,
      participants,
      rounds: enrichRounds(t.rounds),
      groups,
      knockoutRounds: enrichRounds(t.knockoutRounds),
      featuredMatchId: t.featuredMatchId,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private toListItem = (t: StoredTournament): TournamentListItem => ({
    tournamentId: t.tournamentId,
    name: t.name,
    creatorId: t.creatorId,
    creatorDisplayName: t.creatorDisplayName,
    status: t.status,
    format: t.settings.format,
    visibility: t.settings.visibility,
    playerCount: t.participants.length,
    maxPlayers: t.settings.maxPlayers,
    timeControl: t.settings.timeControl,
    createdAt: t.createdAt.toISOString(),
  });

  // ── Locking ──

  private withLock<T>(tournamentId: string, operation: () => Promise<T>): Promise<T> {
    return this.lockProvider.withLock(`tournament:${tournamentId}`, operation);
  }
}

// ── Singleton ──

import { gameService } from "./gameService";
import { getRedisClient } from "../config/redisClient";
import { RedisLockProvider } from "./lockProvider";

function createTournamentService(): TournamentService {
  const redis = getRedisClient();
  const lockProvider = redis ? new RedisLockProvider(redis) : new InMemoryLockProvider();
  return new TournamentService(new MongoTournamentStore(), gameService, lockProvider);
}

export const tournamentService = createTournamentService();
