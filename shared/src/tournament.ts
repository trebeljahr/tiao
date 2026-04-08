import type { FinishReason, TimeControl } from "./protocol";
import type { PlayerColor } from "./tiao";

// ── Format & Status ──

export type TournamentFormat = "round-robin" | "single-elimination" | "groups-knockout";

export type TournamentStatus = "draft" | "registration" | "active" | "finished" | "cancelled";

export type SchedulingMode = "simultaneous" | "time-window";

export type NoShowPolicy = { type: "auto-forfeit"; timeoutMs: number } | { type: "admin-decides" };

export type TournamentVisibility = "public" | "private";

// ── Settings ──

export type TournamentSettings = {
  format: TournamentFormat;
  timeControl: TimeControl;
  scheduling: SchedulingMode;
  noShow: NoShowPolicy;
  visibility: TournamentVisibility;
  minPlayers: number;
  maxPlayers: number;
  /** Group size for groups-knockout format (3 or 4) */
  groupSize?: number;
  /** How many advance per group (default: top half) */
  advancePerGroup?: number;
  /** Required to join a private tournament */
  inviteCode?: string;
};

// ── Participant ──

export type TournamentParticipantStatus = "registered" | "eliminated" | "active" | "winner";

export type TournamentParticipant = {
  playerId: string;
  /** Resolved dynamically from identity cache — optional in DB. */
  displayName?: string;
  profilePicture?: string;
  activeBadges?: string[];
  rating?: number;
  seed: number;
  status: TournamentParticipantStatus;
};

// ── Match ──

export type TournamentMatchStatus = "pending" | "active" | "finished" | "forfeit" | "bye";

export type TournamentMatchPlayer = {
  playerId: string;
  /** Resolved dynamically from identity cache — optional in DB. */
  displayName?: string;
  profilePicture?: string;
  activeBadges?: string[];
  rating?: number;
  seed: number;
};

export type TournamentMatch = {
  matchId: string;
  roundIndex: number;
  matchIndex: number;
  groupId?: string;
  players: [TournamentMatchPlayer | null, TournamentMatchPlayer | null];
  roomId: string | null;
  winner: string | null;
  score: [number, number];
  status: TournamentMatchStatus;
  finishReason?: FinishReason | null;
  historyLength?: number;
  /** Color each player slot was assigned: [player0Color, player1Color] */
  playerColors?: [PlayerColor | null, PlayerColor | null];
  scheduledAt?: string;
  deadline?: string;
};

// ── Round ──

export type TournamentRoundStatus = "pending" | "active" | "finished";

export type TournamentRound = {
  roundIndex: number;
  label: string;
  matches: TournamentMatch[];
  status: TournamentRoundStatus;
};

// ── Group ──

export type TournamentGroupStanding = {
  playerId: string;
  /** Resolved dynamically from identity cache — optional in DB. */
  displayName?: string;
  profilePicture?: string;
  activeBadges?: string[];
  rating?: number;
  seed: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  scoreDiff: number;
};

export type TournamentGroup = {
  groupId: string;
  label: string;
  participantIds: string[];
  rounds: TournamentRound[];
  standings: TournamentGroupStanding[];
};

// ── Snapshot (full tournament state for clients) ──

/** Player identity data resolved from the server's identity cache. */
export type TournamentPlayerIdentity = {
  displayName: string;
  profilePicture?: string;
  rating?: number;
  activeBadges?: string[];
};

export type TournamentSnapshot = {
  tournamentId: string;
  name: string;
  description?: string;
  creatorId: string;
  status: TournamentStatus;
  settings: TournamentSettings;
  participants: TournamentParticipant[];
  /** Elimination bracket rounds (or all rounds for round-robin) */
  rounds: TournamentRound[];
  /** Groups (only for groups-knockout format) */
  groups: TournamentGroup[];
  /** Knockout rounds after group stage (only for groups-knockout) */
  knockoutRounds: TournamentRound[];
  featuredMatchId: string | null;
  /** Identity map: playerId → resolved identity. Use this for display names/pictures. */
  playerIdentities: Record<string, TournamentPlayerIdentity>;
  createdAt: string;
  updatedAt: string;
};

// ── List item (summary for browse views) ──

export type TournamentListItem = {
  tournamentId: string;
  name: string;
  creatorId: string;
  creatorDisplayName: string;
  status: TournamentStatus;
  format: TournamentFormat;
  visibility: TournamentVisibility;
  playerCount: number;
  maxPlayers: number;
  timeControl: TimeControl;
  createdAt: string;
};

// ── Lobby WebSocket messages ──

export type TournamentLobbyMessage =
  | {
      type: "tournament-update";
      tournamentId: string;
    }
  | {
      type: "tournament-match-ready";
      tournamentId: string;
      matchId: string;
      roomId: string;
    }
  | {
      type: "tournament-round-complete";
      tournamentId: string;
      roundIndex: number;
    };
