import type { GameState, PlayerColor, Position, ScoreState } from "./tiao";

export type IdentityKind = "guest" | "account";

export type PlayerIdentity = {
  playerId: string;
  displayName: string;
  kind: IdentityKind;
  email?: string;
  profilePicture?: string;
  hasSeenTutorial?: boolean;
};

export type PlayerSlot = {
  player: PlayerIdentity;
  online: boolean;
};

export type MultiplayerRoomType = "direct" | "matchmaking" | "tournament";

export type MultiplayerStatus = "waiting" | "active" | "finished";

export type MultiplayerSeatAssignments = Record<PlayerColor, PlayerIdentity | null>;

export type MultiplayerRematchState = {
  requestedBy: PlayerColor[];
};

export type MultiplayerTakebackState = {
  /** Which player has a pending request, or null if no active request */
  requestedBy: PlayerColor | null;
  /** How many times each player's requests have been declined since their last move */
  declinedCount: Record<PlayerColor, number>;
};

export type TimeControl = {
  initialMs: number;
  incrementMs: number;
} | null;

export type ClockState = {
  white: number;
  black: number;
  lastMoveAt: string;
};

export type MultiplayerSnapshot = {
  gameId: string;
  roomType: MultiplayerRoomType;
  status: MultiplayerStatus;
  createdAt: string;
  updatedAt: string;
  state: GameState;
  players: PlayerSlot[];
  spectators: PlayerSlot[];
  rematch: MultiplayerRematchState | null;
  takeback: MultiplayerTakebackState | null;
  seats: Record<PlayerColor, PlayerSlot | null>;
  timeControl: TimeControl;
  clock: ClockState | null;
  /** ISO timestamp deadline for the first move in timed games, or null if first move already made / no time control */
  firstMoveDeadline: string | null;
  /** Tournament ID if this is a tournament game */
  tournamentId?: string | null;
};

export type FinishReason = "captured" | "forfeit" | "timeout";

export type MultiplayerGameSummary = {
  gameId: string;
  roomType: MultiplayerRoomType;
  status: MultiplayerStatus;
  createdAt: string;
  updatedAt: string;
  currentTurn: PlayerColor;
  historyLength: number;
  winner: PlayerColor | null;
  finishReason: FinishReason | null;
  yourSeat: PlayerColor | null;
  score: ScoreState;
  players: PlayerSlot[];
  seats: Record<PlayerColor, PlayerSlot | null>;
  rematch: MultiplayerRematchState | null;
};

export type MultiplayerGamesIndex = {
  active: MultiplayerGameSummary[];
  finished: MultiplayerGameSummary[];
};

export type MatchmakingState =
  | {
      status: "idle";
    }
  | {
      status: "searching";
      queuedAt: string;
      timeControl?: TimeControl;
    }
  | {
      status: "matched";
      snapshot: MultiplayerSnapshot;
    };

export type SocialPlayerSummary = {
  playerId: string;
  displayName: string;
  profilePicture?: string;
  email?: string;
  online?: boolean;
};

export type SocialSearchRelationship =
  | "none"
  | "friend"
  | "incoming-request"
  | "outgoing-request";

export type SocialSearchResult = {
  player: SocialPlayerSummary;
  relationship: SocialSearchRelationship;
};

export type GameInvitationSummary = {
  id: string;
  gameId: string;
  roomType: MultiplayerRoomType;
  sender: SocialPlayerSummary;
  recipient: SocialPlayerSummary;
  createdAt: string;
  expiresAt: string;
};

export type SocialOverview = {
  friends: SocialPlayerSummary[];
  incomingFriendRequests: SocialPlayerSummary[];
  outgoingFriendRequests: SocialPlayerSummary[];
  incomingInvitations: GameInvitationSummary[];
  outgoingInvitations: GameInvitationSummary[];
};

export const EMPTY_SOCIAL_OVERVIEW: SocialOverview = {
  friends: [],
  incomingFriendRequests: [],
  outgoingFriendRequests: [],
  incomingInvitations: [],
  outgoingInvitations: [],
};

export type GameActionMessage =
  | {
      type: "place-piece";
      position: Position;
    }
  | {
      type: "jump-piece";
      from: Position;
      to: Position;
    }
  | {
      type: "confirm-jump";
    }
  | {
      type: "undo-pending-jump-step";
    }
  | {
      type: "request-rematch";
    }
  | {
      type: "decline-rematch";
    }
  | {
      type: "cancel-rematch";
    }
  | {
      type: "request-takeback";
    }
  | {
      type: "accept-takeback";
    }
  | {
      type: "decline-takeback";
    }
  | {
      type: "forfeit";
    };

export type ClientToServerMessage = GameActionMessage;

export type ServerToClientMessage =
  | {
      type: "snapshot";
      snapshot: MultiplayerSnapshot;
    }
  | {
      type: "error";
      code?: string;
      message: string;
    }
  | {
      type: "rematch-started";
      gameId: string;
    }
  | {
      type: "flag";
      flaggedColor: PlayerColor;
    }
  | {
      type: "game-aborted";
      reason: string;
      /** If true, the receiving player was automatically re-entered into matchmaking */
      requeuedForMatchmaking: boolean;
      /** The time control to use if re-entering matchmaking */
      timeControl: TimeControl;
    };

export type AuthResponse = {
  player: PlayerIdentity;
};
