import type {
  MyNextMatchResult,
  PendingTournamentMatch,
  PlayerIdentity,
  TournamentGroup,
  TournamentListItem,
  TournamentMatch,
  TournamentMatchPlayer,
  TournamentParticipant,
  TournamentPlayerIdentity,
  TournamentRound,
  TournamentSettings,
  TournamentSnapshot,
  TournamentStatus,
} from "../../shared/src";
import { type GameService, GameServiceError, type TournamentGameCallback } from "./gameService";
import { assertCurrentLocks, withoutLockLeases } from "./lockContext";
import { InMemoryLockProvider, type LockProvider } from "./lockProvider";
import {
  claimTournamentAuthority,
  InMemoryTournamentStore,
  MongoTournamentStore,
  type StoredTournament,
  type TournamentStore,
} from "./tournamentStore";

// Maximum number of "ongoing" (draft/registration/active) tournaments a single
// account may have at once. Prevents a single user from flooding the lobby.
export const MAX_ONGOING_TOURNAMENTS_PER_CREATOR = 10;

import { getFinishReason, getWinner } from "../../shared/src";
import { track } from "../analytics/openpanel";
import { getPlayerProfiles } from "../cache/playerIdentityCache";
import { onTournamentWon } from "./achievementService";

// ── Helpers ──

const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateTournamentId(): string {
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  }
  return id;
}

function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  }
  return code;
}

function generateMatchId(roundIndex: number, matchIndex: number, prefix = ""): string {
  return `${prefix}R${roundIndex}M${matchIndex}`;
}

function participantToMatchPlayer(p: TournamentParticipant): TournamentMatchPlayer {
  return { playerId: p.playerId, seed: p.seed };
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
    const matchCount = size / 2 ** (r + 1);
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

    // Initialize standings (displayName resolved at snapshot time from cache)
    group.standings = groupParticipants.map((p) => ({
      playerId: p.playerId,
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

/**
 * Registered players absent from every lobby this long are unregistered. It
 * exceeds the browser's reconnect backoff so a restart or slow reconnect keeps
 * registrations; the disconnect callback path has already waited its own grace.
 */
const REGISTRATION_ABSENCE_GRACE_MS = 30_000;

export class TournamentService implements TournamentGameCallback {
  private recoveryTimer?: ReturnType<typeof setInterval>;
  private recoveryRun?: Promise<void>;
  private readonly observingSince: number;
  private recoveryCursor?: string;
  private closing = false;
  private readonly operations = new Set<Promise<unknown>>();
  private readonly completedRounds = new WeakMap<StoredTournament, number[]>();
  constructor(
    private readonly store: TournamentStore,
    private readonly gameService: GameService,
    private readonly lockProvider: LockProvider = new InMemoryLockProvider(),
    private readonly clock: () => number = Date.now,
  ) {
    this.observingSince = clock();
    // Wire up the callback so GameService notifies us on game completion
    this.gameService.setTournamentService(this);

    // Auto-drop players from registration-phase tournaments when they disconnect
    this.gameService.onLobbyDisconnect((playerId) => {
      void this.handleLobbyDisconnect(playerId).catch(() => {
        console.error("[tournament] Lobby disconnect cleanup deferred");
      });
    });
  }

  private async handleLobbyDisconnect(playerId: string): Promise<void> {
    const tournaments = await this.store.findRegistrationTournamentsByParticipant(playerId);
    for (const t of tournaments) {
      try {
        await this.withLock(t.tournamentId, async () => {
          const current = await this.store.getTournament(t.tournamentId);
          if (
            !current ||
            current.status !== "registration" ||
            !current.participants.some((p) => p.playerId === playerId)
          )
            return;
          // The lobby callback already waited its reconnect grace. Reconcile
          // under this lease and recheck shared presence: the player may have
          // reconnected while the callback was queued or another lock was held.
          await this.recoverRegistration(current, playerId);
        });
      } catch {
        // Durable recovery retries if this callback or its replica disappears.
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

    return this.runLocked(`tournament-creator:${creator.playerId}`, async () => {
      const ongoingCount = await this.store.countOngoingTournamentsByCreator(creator.playerId);
      if (ongoingCount >= MAX_ONGOING_TOURNAMENTS_PER_CREATOR) {
        throw new GameServiceError(
          409,
          "TOURNAMENT_LIMIT_REACHED",
          `You can only have ${MAX_ONGOING_TOURNAMENTS_PER_CREATOR} ongoing tournaments at a time. Finish, cancel, or delete one before creating another.`,
        );
      }

      // Auto-generate invite code for private tournaments if not provided
      if (settings.visibility === "private" && !settings.inviteCode) {
        // biome-ignore lint/style/noParameterAssign: enrich settings with generated invite code
        settings = { ...settings, inviteCode: generateInviteCode() };
      }

      const tournamentId = generateTournamentId();
      const created = await this.store.createTournament({
        tournamentId,
        name,
        description,
        creatorId: creator.playerId,
        status: "registration",
        settings,
        registrationAbsences: [],
        participants: [],
        rounds: [],
        groups: [],
        knockoutRounds: [],
        featuredMatchId: null,
        isFeatured: false,
        invitedUserIds: [],
      });
      this.broadcastTournamentListUpdate();
      return created;
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

      tournament.registrationAbsences = (tournament.registrationAbsences ?? []).filter(
        (p) => p.playerId !== player.playerId,
      );
      tournament.participants.push({
        playerId: player.playerId,
        seed: tournament.participants.length + 1,
        status: "registered",
      });

      const saved = await this.persist(tournament);
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
      tournament.registrationAbsences = (tournament.registrationAbsences ?? []).filter(
        (p) => p.playerId !== playerId,
      );

      // Re-number seeds
      tournament.participants.forEach((p, i) => {
        p.seed = i + 1;
      });

      const saved = await this.persist(tournament);
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

      if (tournament.status === "active") {
        await this.recoverTournament(tournament);
        return tournament;
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

      tournament.registrationAbsences = [];
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
      const saved = await this.persist(tournament);

      // Create GameRooms for the first round
      await this.createRoomsForActiveRound(saved);

      this.broadcastTournamentUpdate(saved);
      this.broadcastTournamentListUpdate();
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
      tournament.cleanupPending = true;
      const saved = await this.persist(tournament);
      await this.settlePendingEffects(saved);
      this.broadcastTournamentUpdate(saved);
      this.broadcastTournamentListUpdate();
      return saved;
    });
  }

  /**
   * DEV-ONLY: fabricate a match result without playing a real game. Callers
   * must gate on NODE_ENV themselves — this helper just does the work.
   *
   * Mirrors the side-effects of `onGameCompleted` (update match row, advance
   * bracket, create rooms for the next round, broadcast) but skips the
   * underlying GameRoom — the match is treated as finished regardless of
   * whether a room was ever created for it.
   */
  async devForceMatchResult(
    tournamentId: string,
    matchId: string,
    result: {
      winnerId: string;
      scoreWhite: number;
      scoreBlack: number;
      finishReason: "captured" | "forfeit" | "timeout";
    },
  ): Promise<StoredTournament> {
    return this.withLock(tournamentId, async () => {
      const tournament = await this.getTournament(tournamentId);
      if (tournament.status !== "active") {
        throw new GameServiceError(409, "INVALID_STATUS", "Tournament is not active.");
      }
      const match = this.findMatch(tournament, matchId);
      if (!match) {
        throw new GameServiceError(404, "MATCH_NOT_FOUND", "Match not found.");
      }
      if (match.status === "finished" || match.status === "forfeit" || match.status === "bye") {
        throw new GameServiceError(409, "MATCH_ALREADY_DONE", "Match is already completed.");
      }
      if (!match.players[0] || !match.players[1]) {
        throw new GameServiceError(
          409,
          "MATCH_NOT_READY",
          "Cannot force result on an unfilled match.",
        );
      }
      if (
        match.players[0].playerId !== result.winnerId &&
        match.players[1].playerId !== result.winnerId
      ) {
        throw new GameServiceError(400, "INVALID_WINNER", "winnerId is not one of the players.");
      }

      match.winner = result.winnerId;
      match.status = "finished";
      // Align score to player slot order (p0Score, p1Score).
      const p0Color = match.playerColors?.[0] ?? "white";
      match.score =
        p0Color === "white"
          ? [result.scoreWhite, result.scoreBlack]
          : [result.scoreBlack, result.scoreWhite];
      match.finishReason = result.finishReason;
      match.historyLength = 0;

      if (match.groupId) {
        this.updateGroupStandings(tournament, match);
      }

      if (tournament.settings.format === "single-elimination") {
        const loserId = match.players.find((p) => p && p.playerId !== match.winner)?.playerId;
        if (loserId) {
          const loser = tournament.participants.find((p) => p.playerId === loserId);
          if (loser) loser.status = "eliminated";
        }
      }

      this.checkRoundAdvancement(tournament);
      const saved = await this.persist(tournament);
      await this.createRoomsForActiveRound(saved);
      this.broadcastTournamentUpdate(saved);
      return saved;
    });
  }

  // ── Featured flag (site admin) ──

  async setFeatured(tournamentId: string, featured: boolean): Promise<StoredTournament> {
    return this.withLock(tournamentId, async () => {
      const tournament = await this.getTournament(tournamentId);
      tournament.isFeatured = featured;
      const saved = await this.persist(tournament);
      this.broadcastTournamentListUpdate();
      return saved;
    });
  }

  async deleteTournament(tournamentId: string, adminId: string): Promise<void> {
    return this.withLock(tournamentId, async () => {
      const tournament = await this.getTournament(tournamentId);

      if (tournament.creatorId !== adminId) {
        throw new GameServiceError(403, "NOT_ADMIN", "Only the tournament creator can delete it.");
      }

      if (tournament.status !== "cancelled") {
        throw new GameServiceError(
          409,
          "NOT_CANCELLED",
          "Only cancelled tournaments can be deleted. Cancel it first.",
        );
      }

      await this.settlePendingEffects(tournament);
      await this.store.deleteTournament(tournamentId, tournament);
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

      const saved = await this.persist(tournament);
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

      const saved = await this.persist(tournament);
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
      const saved = await this.persist(tournament);
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

      if (tournament.status !== "active") {
        throw new GameServiceError(409, "INVALID_STATUS", "Tournament is not active.");
      }
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
      const saved = await this.persist(tournament);
      await this.createRoomsForActiveRound(saved);
      this.broadcastTournamentUpdate(saved);
      return saved;
    });
  }

  // ── Game Completion Callback ──

  async onGameCompleted(roomId: string): Promise<void> {
    // The game is already committed. Its caller may release the room lease
    // before this fire-and-forget notification acquires tournament authority.
    return withoutLockLeases(async () => {
      const tournament = await this.store.findTournamentByMatchRoomId(roomId);
      if (!tournament) return;
      await this.withLock(tournament.tournamentId, async () => {
        const current = await this.store.getTournament(tournament.tournamentId, true);
        if (current) await this.recoverTournament(current);
      });
    });
  }

  // ── Invite Link Access ──

  async accessTournament(
    tournamentId: string,
    playerId: string,
    inviteCode: string,
  ): Promise<StoredTournament> {
    return this.withLock(tournamentId, async () => {
      const tournament = await this.getTournament(tournamentId);

      if (tournament.settings.visibility !== "private") {
        throw new GameServiceError(400, "NOT_PRIVATE", "This tournament is not private.");
      }

      if (tournament.settings.inviteCode && inviteCode !== tournament.settings.inviteCode) {
        throw new GameServiceError(403, "INVALID_INVITE_CODE", "Invalid invite code.");
      }

      // Add user to invitedUserIds if not already present
      if (!tournament.invitedUserIds.includes(playerId)) {
        tournament.invitedUserIds.push(playerId);
        return this.persist(tournament);
      }

      return tournament;
    });
  }

  // ── Queries ──

  async getTournamentSnapshot(
    tournamentId: string,
    requesterId?: string,
  ): Promise<TournamentSnapshot> {
    const t = await this.getTournament(tournamentId);

    // Private tournaments are only visible to creator, participants, and invited users
    if (t.settings.visibility === "private" && requesterId) {
      const isAllowed =
        t.creatorId === requesterId ||
        t.participants.some((p) => p.playerId === requesterId) ||
        t.invitedUserIds.includes(requesterId);
      if (!isAllowed) {
        throw new GameServiceError(404, "TOURNAMENT_NOT_FOUND", "Tournament not found.");
      }
    }

    return this.toSnapshot(t);
  }

  async listPublicTournaments(status?: TournamentStatus): Promise<TournamentListItem[]> {
    const tournaments = await this.store.listPublicTournaments(status ? { status } : undefined);
    return this.toListItems(tournaments);
  }

  async listMyTournaments(playerId: string): Promise<TournamentListItem[]> {
    const tournaments = await this.store.listTournamentsForPlayer(playerId);
    return this.toListItems(tournaments);
  }

  async listAllTournamentsForAdmin(): Promise<TournamentListItem[]> {
    const tournaments = await this.store.listAllTournaments();
    return this.toListItems(tournaments);
  }

  // ── "What's my next tournament match?" ──

  /**
   * Decide what should happen when the player asks for their next match in
   * this tournament. See `MyNextMatchResult` for the shape of the answer.
   *
   * Walks the tournament's rounds (main + knockout + group rounds) in order
   * and returns the first match that applies to the player. Implementation
   * notes:
   *
   * - "ready" wins over everything else: if they already have an active
   *   match with a room, we just drop them in.
   * - "waiting" carries an optional `watchRoomId` so the client can route
   *   them into an ongoing match as a spectator instead of parking them
   *   on the bracket page. We pick the first active match in the same
   *   round they're currently waiting on; failing that, any active match
   *   in the tournament.
   * - "done" distinguishes winner / eliminated / finished so the client
   *   can show the right end-of-tournament copy.
   */
  async getMyNextMatch(tournamentId: string, playerId: string): Promise<MyNextMatchResult> {
    const tournament = await this.getTournament(tournamentId);

    const participant = tournament.participants.find((p) => p.playerId === playerId);
    if (!participant) {
      return { state: "not-participant" };
    }

    type RoundWithContext = { round: TournamentRound; groupLabel?: string };
    const orderedRounds: RoundWithContext[] = [];
    for (const round of tournament.rounds) orderedRounds.push({ round });
    for (const group of tournament.groups) {
      for (const round of group.rounds) {
        orderedRounds.push({ round, groupLabel: group.label });
      }
    }
    for (const round of tournament.knockoutRounds) orderedRounds.push({ round });

    const isPlayerInMatch = (match: TournamentMatch) =>
      match.players.some((mp) => mp?.playerId === playerId);

    // 1. An ACTIVE match for the player with a roomId → ready to play.
    for (const { round } of orderedRounds) {
      for (const match of round.matches) {
        if (match.status !== "active") continue;
        if (!match.roomId) continue;
        if (isPlayerInMatch(match)) {
          return { state: "ready", roomId: match.roomId, matchId: match.matchId };
        }
      }
    }

    // 2. A PENDING match for the player → they're waiting. Figure out what
    //    we can offer them to watch while they wait.
    let waitingRound: TournamentRound | null = null;
    let waitingLabel = "";
    for (const { round, groupLabel } of orderedRounds) {
      for (const match of round.matches) {
        if (match.status !== "pending") continue;
        if (!isPlayerInMatch(match)) continue;
        waitingRound = round;
        waitingLabel = groupLabel ? `${groupLabel} · ${round.label}` : round.label;
        break;
      }
      if (waitingRound) break;
    }

    if (waitingRound) {
      // Prefer an active match in the SAME round (more relevant to what
      // they're waiting on). Fall back to any active match anywhere.
      let watchRoomId: string | null = null;
      let watchMatchId: string | null = null;

      for (const match of waitingRound.matches) {
        if (match.status === "active" && match.roomId) {
          watchRoomId = match.roomId;
          watchMatchId = match.matchId;
          break;
        }
      }
      if (!watchRoomId) {
        for (const { round } of orderedRounds) {
          for (const match of round.matches) {
            if (match.status === "active" && match.roomId) {
              watchRoomId = match.roomId;
              watchMatchId = match.matchId;
              break;
            }
          }
          if (watchRoomId) break;
        }
      }

      return {
        state: "waiting",
        watchRoomId,
        watchMatchId,
        waitingOnLabel: waitingLabel,
      };
    }

    // 3. No pending/active match for this player — they're done.
    if (tournament.status === "finished" || tournament.status === "cancelled") {
      if (participant.status === "winner") {
        return { state: "done", outcome: "winner" };
      }
      return { state: "done", outcome: "finished" };
    }
    if (participant.status === "eliminated") {
      return { state: "done", outcome: "eliminated" };
    }
    if (participant.status === "winner") {
      return { state: "done", outcome: "winner" };
    }
    // Round-robin with all their games done but tournament still running.
    return { state: "done", outcome: "finished" };
  }

  // ── Pending "match ready" notifications ──

  /**
   * List every tournament match this player is currently sitting in that
   * has a live game room. The sticky "tournament match ready" notification
   * uses this as its source of truth — it gets re-queried on every mount
   * and on every `tournament-match-ready` socket message, so the toast
   * survives reloads without any client-side persistence.
   */
  async listPendingMatchReady(playerId: string): Promise<PendingTournamentMatch[]> {
    const tournaments = await this.store.listTournamentsForPlayer(playerId);
    const pending: PendingTournamentMatch[] = [];

    // Batch-resolve opponent display names (best-effort).
    const opponentIds = new Set<string>();
    for (const t of tournaments) {
      if (t.status !== "active") continue;
      for (const match of this.iterAllMatches(t)) {
        if (match.status !== "active" || !match.roomId) continue;
        if (!match.players.some((p) => p?.playerId === playerId)) continue;
        for (const p of match.players) {
          if (p && p.playerId !== playerId) opponentIds.add(p.playerId);
        }
      }
    }
    const profiles = await getPlayerProfiles([...opponentIds]);

    for (const t of tournaments) {
      if (t.status !== "active") continue;
      for (const match of this.iterAllMatches(t)) {
        if (match.status !== "active" || !match.roomId) continue;
        if (!match.players.some((p) => p?.playerId === playerId)) continue;

        const opponent = match.players.find((p) => p && p.playerId !== playerId);
        pending.push({
          tournamentId: t.tournamentId,
          tournamentName: t.name,
          matchId: match.matchId,
          roomId: match.roomId,
          opponentPlayerId: opponent?.playerId ?? null,
          opponentDisplayName: opponent
            ? (profiles.get(opponent.playerId)?.displayName ?? null)
            : null,
        });
      }
    }

    return pending;
  }

  private *iterAllMatches(tournament: StoredTournament): Generator<TournamentMatch> {
    for (const round of tournament.rounds) {
      for (const match of round.matches) yield match;
    }
    for (const round of tournament.knockoutRounds) {
      for (const match of round.matches) yield match;
    }
    for (const group of tournament.groups) {
      for (const round of group.rounds) {
        for (const match of round.matches) yield match;
      }
    }
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

  private checkRoundAdvancement(tournament: StoredTournament): void {
    if (tournament.status !== "active") return;
    const before = new Set(this.allRounds(tournament).filter((r) => r.status === "finished"));
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
    this.completedRounds.set(
      tournament,
      this.allRounds(tournament)
        .filter((r) => r.status === "finished" && !before.has(r))
        .map((r) => r.roundIndex),
    );
  }

  private advanceRoundRobin(tournament: StoredTournament): void {
    // Mark any fully-finished rounds as "finished" for standings purposes.
    for (const round of tournament.rounds) {
      if (round.status !== "active" && round.status !== "pending") continue;
      const allDone =
        round.matches.length > 0 &&
        round.matches.every(
          (m) => m.status === "finished" || m.status === "forfeit" || m.status === "bye",
        );
      if (allDone && round.status === "active") {
        round.status = "finished";
      }
    }

    // Round-robin uses SOFT round boundaries: a player who finishes their
    // current-round match shouldn't have to wait for the rest of the round
    // before their next opponent comes online. As soon as two players are
    // both "free" (no active match anywhere) and share a pending match,
    // we activate that match regardless of which round it belongs to.
    this.activateFreeRoundRobinMatches(tournament);

    // If every match in every round is done, the tournament is finished.
    const allMatchesDone = tournament.rounds.every((round) =>
      round.matches.every(
        (m) => m.status === "finished" || m.status === "forfeit" || m.status === "bye",
      ),
    );
    if (allMatchesDone) {
      this.finishTournament(tournament);
    }
  }

  /**
   * Round-robin only: find any pending match whose two players are both
   * currently free (no `active` match in the tournament) and activate it.
   *
   * Rationale: round-robin is commutative — "Alice vs Dave" can happen at
   * any time, it doesn't need the rest of Round 1 to finish first. This
   * keeps the tournament flowing instead of leaving a player twiddling
   * their thumbs because one other pair is still playing a long game.
   *
   * Only called for `format === "round-robin"`. Single-elim and
   * groups-knockout are bracket-ordered and must stay sequential.
   */
  private activateFreeRoundRobinMatches(tournament: StoredTournament): void {
    if (tournament.settings.format !== "round-robin") return;

    // Collect players who currently have any active match anywhere.
    const busyPlayers = new Set<string>();
    for (const round of tournament.rounds) {
      for (const match of round.matches) {
        if (match.status !== "active") continue;
        for (const mp of match.players) {
          if (mp) busyPlayers.add(mp.playerId);
        }
      }
    }

    // Walk pending matches in round order (so earlier rounds get preferred
    // when ties occur) and activate any where both players are free.
    // Each activation updates `busyPlayers` so we don't double-book a
    // player in the same pass.
    for (const round of tournament.rounds) {
      for (const match of round.matches) {
        if (match.status !== "pending") continue;
        if (!match.players[0] || !match.players[1]) continue;

        const p0 = match.players[0].playerId;
        const p1 = match.players[1].playerId;
        if (busyPlayers.has(p0) || busyPlayers.has(p1)) continue;

        // Activate the match. Flipping round.status to "active" is
        // required because createRoomsForActiveRound only walks active
        // rounds when deciding which matches to create rooms for.
        if (round.status === "pending") round.status = "active";
        busyPlayers.add(p0);
        busyPlayers.add(p1);
      }
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
      if (nextPending && !group.rounds.some((r) => r.status === "active")) {
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

    tournament.completionEffectsPending = true;
  }

  private async createRoomsForActiveRound(tournament: StoredTournament): Promise<void> {
    if (tournament.status !== "active") {
      await this.settlePendingEffects(tournament);
      return;
    }
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
    if (playerIds.size === 0) return;
    const profiles = await getPlayerProfiles([...playerIds]);
    const busy = new Set(
      allRounds
        .flatMap((r) => r.matches)
        .filter((m) => m.status === "active")
        .flatMap((m) => m.players)
        .filter((p) => p !== null)
        .map((p) => p.playerId),
    );

    for (const round of allRounds) {
      if (round.status !== "active") continue;

      for (const match of round.matches) {
        if (match.status !== "pending") continue;
        if (match.roomId) continue;
        if (!match.players[0] || !match.players[1]) continue;

        const p0 = match.players[0];
        const p1 = match.players[1];
        if (
          tournament.settings.format === "round-robin" &&
          (busy.has(p0.playerId) || busy.has(p1.playerId))
        )
          continue;
        const prof1 = profiles.get(p0.playerId);
        const prof2 = profiles.get(p1.playerId);

        await assertCurrentLocks();
        const identity1: PlayerIdentity = {
          playerId: p0.playerId,
          displayName: prof1?.displayName ?? p0.displayName ?? "Player",
          kind: "account",
          profilePicture: prof1?.profilePicture,
        };
        const identity2: PlayerIdentity = {
          playerId: p1.playerId,
          displayName: prof2?.displayName ?? p1.displayName ?? "Player",
          kind: "account",
          profilePicture: prof2?.profilePicture,
        };

        const room = await this.gameService.createTournamentGame(
          identity1,
          identity2,
          tournament.settings.timeControl,
          tournament.tournamentId,
          match.matchId,
          {
            boardSize: tournament.settings.boardSize,
            scoreToWin: tournament.settings.scoreToWin,
          },
        );

        match.roomId = room.id;
        match.status = "active";
        busy.add(p0.playerId);
        busy.add(p1.playerId);

        // Record which color each player was assigned
        const p0Id = match.players[0].playerId;
        match.playerColors = [
          room.seats.white?.playerId === p0Id ? "white" : "black",
          room.seats.white?.playerId === p0Id ? "black" : "white",
        ];

        // A crash between room creation and this CAS is repaired using the
        // stable (tournamentId, matchId) room identity. Publish only committed links.
        await this.persist(tournament);

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
      }
    }
  }

  private allRounds(tournament: StoredTournament): TournamentRound[] {
    return [
      ...tournament.rounds,
      ...tournament.knockoutRounds,
      ...tournament.groups.flatMap((g) => g.rounds),
    ];
  }

  private async persist(tournament: StoredTournament): Promise<StoredTournament> {
    const saved = await this.store.saveTournament(tournament);
    // Keep nested references used by the current locked operation, but advance
    // the CAS identity before another save in that operation.
    tournament.revision = saved.revision;
    tournament.authorityToken = saved.authorityToken;
    tournament.updatedAt = saved.updatedAt;
    for (const index of this.completedRounds.get(tournament) ?? []) {
      this.broadcastRoundComplete(tournament, index);
    }
    this.completedRounds.delete(tournament);
    return tournament;
  }

  private async settlePendingEffects(tournament: StoredTournament): Promise<void> {
    if (tournament.status === "cancelled") {
      // Reconcile tombstones too: an old in-flight room insert may arrive
      // after the first cleanup commit, even when its tournament CAS fails.
      await assertCurrentLocks();
      await this.gameService.unlinkTournamentGames(tournament.tournamentId);
      if (tournament.cleanupPending) {
        tournament.cleanupPending = false;
        await this.persist(tournament);
      }
    }
    if (tournament.status === "finished" && tournament.completionEffectsPending) {
      await assertCurrentLocks();
      const winner = tournament.participants.find((p) => p.status === "winner");
      // Achievement's unique key makes a replay safe. External analytics and
      // notifications remain best effort; they are not exactly-once deliveries.
      if (winner) await onTournamentWon(winner.playerId);
      for (const p of tournament.participants) {
        track("tournament_finished", {
          profileId: p.playerId,
          tournament_id: tournament.tournamentId,
          format: tournament.settings.format,
          participants: tournament.participants.length,
          result: p.status === "winner" ? "won" : "eliminated",
        });
      }
      tournament.completionEffectsPending = false;
      await this.persist(tournament);
      this.broadcastTournamentListUpdate();
    }
  }

  /** `graceElapsed` is a player whose local disconnect grace already ran out. */
  private async recoverRegistration(
    tournament: StoredTournament,
    graceElapsed?: string,
  ): Promise<void> {
    // Disconnect callbacks are an optimization only: a retiring/crashed replica
    // may never deliver one. Persist the grace period so another owner resumes it.
    const presence = await Promise.all(
      tournament.participants.map(async (participant) => ({
        playerId: participant.playerId,
        connected: await this.gameService.isPlayerConnectedToLobby(participant.playerId),
      })),
    );
    const now = this.clock();
    const before = tournament.registrationAbsences ?? [];
    const after: { playerId: string; since: number }[] = [];
    const removed: string[] = [];
    for (const { playerId, connected } of presence) {
      if (connected) continue;
      const prior = before.find((p) => p.playerId === playerId);
      // Never count time before this worker could observe reconnects: after a
      // full restart every lobby lease is gone until clients reconnect.
      const since =
        prior && Number.isFinite(prior.since) && prior.since <= now
          ? Math.max(prior.since, this.observingSince)
          : now;
      if (playerId === graceElapsed || now - since >= REGISTRATION_ABSENCE_GRACE_MS)
        removed.push(playerId);
      else after.push({ playerId, since });
    }
    if (!removed.length && JSON.stringify(before) === JSON.stringify(after)) return;
    tournament.registrationAbsences = after;
    if (removed.length) {
      tournament.participants = tournament.participants.filter(
        (p) => !removed.includes(p.playerId),
      );
      tournament.participants.forEach((p, i) => {
        p.seed = i + 1;
      });
    }
    await this.persist(tournament);
    if (removed.length) {
      this.broadcastTournamentUpdate(tournament);
      for (const playerId of removed)
        this.gameService.broadcastLobby(playerId, {
          type: "tournament-update",
          tournamentId: tournament.tournamentId,
        });
      this.broadcastTournamentListUpdate();
    }
  }

  private async recoverTournament(tournament: StoredTournament): Promise<void> {
    if (tournament.status === "registration") {
      await this.recoverRegistration(tournament);
      return;
    }
    if (tournament.status !== "active") {
      await this.settlePendingEffects(tournament);
      return;
    }
    // Room commits are the durable completion journal. Polling repairs a lost
    // callback after a worker dies, without applying any match result twice.
    let changed = false;
    for (const round of this.allRounds(tournament)) {
      for (const match of round.matches) {
        if (!match.roomId || match.status !== "active") continue;
        const room = await this.gameService.getSnapshot(match.roomId);
        if (room.status !== "finished") continue;
        const winner = getWinner(room.state);
        const seat = winner && room.seats[winner];
        // Group and round-robin draws are completed results. An elimination
        // draw needs the existing admin forfeit decision; never invent a winner
        // or advance a bye while both players remain eligible.
        if (!seat && !match.groupId && tournament.settings.format !== "round-robin") continue;
        if (winner && !seat) continue;
        match.winner = seat ? seat.player.playerId : null;
        match.status = "finished";
        const p0 = match.playerColors?.[0] ?? "white";
        const p1 = match.playerColors?.[1] ?? "black";
        match.score = [room.state.score[p0], room.state.score[p1]];
        match.finishReason = getFinishReason(room.state);
        match.historyLength = room.state.history.length;
        if (match.groupId) this.updateGroupStandings(tournament, match);
        if (tournament.settings.format === "single-elimination") {
          const loserId = match.players.find((p) => p && p.playerId !== match.winner)?.playerId;
          const loser = tournament.participants.find((p) => p.playerId === loserId);
          if (loser) loser.status = "eliminated";
        }
        changed = true;
      }
    }
    if (changed) {
      this.checkRoundAdvancement(tournament);
      await this.persist(tournament);
    }
    await this.createRoomsForActiveRound(tournament);
    if (changed) this.broadcastTournamentUpdate(tournament);
  }

  /** Bounded pages prevent a large tournament history from monopolizing a worker. */
  async recoverPending(): Promise<void> {
    if (this.closing) return;
    if (this.recoveryRun) return this.recoveryRun;
    const run = async () => {
      const tournaments = await this.store.listRecoveryTournaments(this.recoveryCursor, 25);
      this.recoveryCursor = tournaments.length === 25 ? tournaments[24].tournamentId : undefined;
      for (const tournament of tournaments) {
        if (this.closing) break;
        try {
          await this.withLock(tournament.tournamentId, async () => {
            const current = await this.store.getTournament(tournament.tournamentId, true);
            if (current) await this.recoverTournament(current);
          });
        } catch {
          console.error("[tournament] Recovery deferred; durable state retained");
        }
      }
    };
    this.recoveryRun = run().finally(() => {
      this.recoveryRun = undefined;
    });
    return this.recoveryRun;
  }

  async startRecovery(): Promise<void> {
    if (this.closing || this.recoveryTimer) return;
    await this.recoverPending();
    if (this.closing) return;
    this.recoveryTimer = setInterval(() => {
      void this.recoverPending().catch(() => {
        console.error("[tournament] Recovery scan deferred");
      });
    }, 5_000);
    this.recoveryTimer.unref();
  }

  async close(): Promise<void> {
    this.closing = true;
    clearInterval(this.recoveryTimer);
    await Promise.allSettled([this.recoveryRun, ...this.operations]);
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

  /**
   * Tell EVERY connected lobby socket that the tournament listing has
   * changed — fires on create/start/cancel/finish and when an admin toggles
   * the featured flag. Without this, the lobby tournament list on
   * non-participants never updates (bug: "sometimes tournaments don't show
   * up in the lobby").
   */
  broadcastTournamentListUpdate(): void {
    this.gameService.broadcastLobbyToAll({ type: "tournament-list-update" });
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

  /**
   * Broadcast a live score update to all tournament participants.
   * Called by gameService after each move in a tournament game.
   */
  async broadcastLiveScore(
    tournamentId: string,
    matchId: string,
    score: { white: number; black: number },
  ): Promise<void> {
    const tournament = await this.store.getTournament(tournamentId);
    if (!tournament) return;

    // Find the match across all round arrays (including group-stage rounds)
    let match: TournamentMatch | undefined;
    const allRounds: TournamentRound[] = [
      ...tournament.rounds,
      ...tournament.knockoutRounds,
      ...(tournament.groups ?? []).flatMap((g: any) => g.rounds ?? []),
    ];
    for (const round of allRounds) {
      match = round.matches.find((m: TournamentMatch) => m.matchId === matchId);
      if (match) break;
    }
    if (!match) return;

    // Map white/black score to [player0Score, player1Score] based on color assignments
    const p0Color = match.playerColors?.[0] ?? "white";
    const p1Color = match.playerColors?.[1] ?? "black";
    const mappedScore: [number, number] = [score[p0Color], score[p1Color]];

    const payload = {
      type: "tournament-score-update" as const,
      tournamentId,
      matchId,
      score: mappedScore,
    };

    const notified = new Set<string>();
    for (const p of tournament.participants) {
      this.gameService.broadcastLobby(p.playerId, payload);
      notified.add(p.playerId);
    }
    if (!notified.has(tournament.creatorId)) {
      this.gameService.broadcastLobby(tournament.creatorId, payload);
    }
  }

  // ── Serialization ──

  private async toSnapshot(t: StoredTournament): Promise<TournamentSnapshot> {
    // Collect all unique player IDs across participants, matches, standings, and creator
    const playerIds = new Set<string>();
    playerIds.add(t.creatorId);
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

    // Batch-fetch fresh profiles from identity cache
    const profiles = await getPlayerProfiles([...playerIds]);

    // Build the playerIdentities map for the client
    const playerIdentities: Record<string, TournamentPlayerIdentity> = {};
    for (const [id, p] of profiles) {
      playerIdentities[id] = {
        displayName: p.displayName,
        profilePicture: p.profilePicture,
        rating: p.rating,
        activeBadges: p.activeBadges,
      };
    }

    const enrich = (id: string) => {
      const p = profiles.get(id);
      if (!p) return {};
      return {
        displayName: p.displayName,
        profilePicture: p.profilePicture,
        // Previously only displayName + profilePicture were projected onto
        // each participant/match-player/standings row, which dropped the
        // player's activeBadges and rating — PlayerIdentityRow then saw
        // `activeBadges: undefined` and resolvePlayerBadges returned [],
        // so achievement badges never rendered next to other players in
        // the tournament standings table or match bracket.
        activeBadges: p.activeBadges,
        rating: p.rating,
      };
    };

    // Enrich participants (backfill displayName/profilePicture for backward compat)
    const participants: TournamentParticipant[] = t.participants.map((p) => ({
      ...p,
      ...enrich(p.playerId),
    }));

    // Enrich match players in rounds
    const enrichRounds = (rounds: TournamentRound[]): TournamentRound[] =>
      rounds.map((round) => ({
        ...round,
        matches: round.matches.map((match) => ({
          ...match,
          players: match.players.map((mp) =>
            mp ? { ...mp, ...enrich(mp.playerId) } : null,
          ) as TournamentMatch["players"],
        })),
      }));

    // Enrich groups
    const groups: TournamentGroup[] = t.groups.map((group) => ({
      ...group,
      rounds: enrichRounds(group.rounds),
      standings: group.standings.map((s) => ({
        ...s,
        ...enrich(s.playerId),
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
      isFeatured: t.isFeatured,
      playerIdentities,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private async toListItems(tournaments: StoredTournament[]): Promise<TournamentListItem[]> {
    // Batch-resolve creator profiles
    const creatorIds = [...new Set(tournaments.map((t) => t.creatorId))];
    const profiles = await getPlayerProfiles(creatorIds);

    return tournaments.map((t) => ({
      tournamentId: t.tournamentId,
      name: t.name,
      creatorId: t.creatorId,
      creatorDisplayName: profiles.get(t.creatorId)?.displayName ?? "Unknown",
      status: t.status,
      format: t.settings.format,
      visibility: t.settings.visibility,
      playerCount: t.participants.length,
      maxPlayers: t.settings.maxPlayers,
      timeControl: t.settings.timeControl,
      boardSize: t.settings.boardSize ?? 19,
      scoreToWin: t.settings.scoreToWin ?? 10,
      isFeatured: t.isFeatured,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  // ── Locking ──

  private withLock<T>(tournamentId: string, operation: () => Promise<T>): Promise<T> {
    return this.runLocked(`tournament:${tournamentId}`, operation);
  }

  private runLocked<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (this.closing)
      return Promise.reject(new GameServiceError(503, "DRAINING", "Server is draining."));
    const result = this.lockProvider.withLock(key, operation);
    this.operations.add(result);
    void result.finally(() => this.operations.delete(result)).catch(() => undefined);
    return result;
  }
}

// ── Singleton ──

import { getRedisClient } from "../config/redisClient";
import { gameService } from "./gameService";
import { RedisLockProvider } from "./lockProvider";

function createTournamentService(): TournamentService {
  if (process.env.NODE_ENV === "test") {
    return new TournamentService(new InMemoryTournamentStore(), gameService);
  }
  const redis = getRedisClient();
  if (!redis) throw new Error("[tournament] REDIS_URL is required for tournament authority.");
  const lockProvider = new RedisLockProvider(redis, { claim: claimTournamentAuthority });
  return new TournamentService(new MongoTournamentStore(), gameService, lockProvider);
}

export const tournamentService = createTournamentService();
