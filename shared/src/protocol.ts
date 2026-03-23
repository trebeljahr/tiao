import type { GameState, PlayerColor, Position } from "./tiao";

export type IdentityKind = "guest" | "account";

export type PlayerIdentity = {
  playerId: string;
  displayName: string;
  kind: IdentityKind;
  email?: string;
  profilePicture?: string;
};

export type PlayerSlot = {
  player: PlayerIdentity;
  online: boolean;
};

export type MultiplayerStatus = "waiting" | "active" | "finished";

export type MultiplayerSnapshot = {
  gameId: string;
  status: MultiplayerStatus;
  createdAt: string;
  updatedAt: string;
  state: GameState;
  seats: Record<PlayerColor, PlayerSlot | null>;
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
    };

export type AuthResponse = {
  token: string;
  player: PlayerIdentity;
};
