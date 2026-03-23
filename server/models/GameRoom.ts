import { Document, Schema, model, models } from "mongoose";
import {
  GameState,
  MultiplayerSeatAssignments,
  MultiplayerStatus,
  PlayerIdentity,
} from "../../shared/src";

const PlayerIdentitySchema = new Schema<PlayerIdentity>(
  {
    playerId: {
      type: String,
      required: true,
      trim: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    kind: {
      type: String,
      required: true,
      enum: ["guest", "account"],
    },
    email: {
      type: String,
      trim: true,
    },
    profilePicture: {
      type: String,
      trim: true,
    },
  },
  {
    _id: false,
  }
);

export interface IGameRoom extends Document {
  roomId: string;
  status: MultiplayerStatus;
  state: GameState;
  seats: MultiplayerSeatAssignments;
  createdAt: Date;
  updatedAt: Date;
}

const GameRoomSchema = new Schema<IGameRoom>(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: ["waiting", "active", "finished"],
      index: true,
    },
    state: {
      type: Schema.Types.Mixed,
      required: true,
    },
    seats: {
      white: {
        type: PlayerIdentitySchema,
        default: null,
      },
      black: {
        type: PlayerIdentitySchema,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

GameRoomSchema.index({ "seats.white.playerId": 1, status: 1, updatedAt: -1 });
GameRoomSchema.index({ "seats.black.playerId": 1, status: 1, updatedAt: -1 });

const GameRoom = models.GameRoom || model<IGameRoom>("GameRoom", GameRoomSchema);

export default GameRoom;
