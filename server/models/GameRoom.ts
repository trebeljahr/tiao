import { Document, Schema, model, models } from "mongoose";
import {
  GameState,
  MultiplayerRematchState,
  MultiplayerTakebackState,
  MultiplayerSeatAssignments,
  MultiplayerRoomType,
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
    rating: {
      type: Number,
    },
  },
  {
    _id: false,
  },
);

export interface IGameRoom extends Document {
  roomId: string;
  roomType: MultiplayerRoomType;
  status: MultiplayerStatus;
  state: GameState;
  players: PlayerIdentity[];
  rematch: MultiplayerRematchState | null;
  takeback: MultiplayerTakebackState | null;
  seats: MultiplayerSeatAssignments;
  timeControl: { initialMs: number; incrementMs: number } | null;
  clockMs: { white: number; black: number } | null;
  lastMoveAt: Date | null;
  firstMoveDeadline: Date | null;
  ratingBefore: { white: number; black: number } | null;
  ratingAfter: { white: number; black: number } | null;
  tournamentId: string | null;
  tournamentMatchId: string | null;
  staleAt: Date | null;
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
    roomType: {
      type: String,
      required: true,
      enum: ["direct", "matchmaking", "tournament"],
      default: "direct",
      index: true,
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
    players: {
      type: [PlayerIdentitySchema],
      default: [],
    },
    rematch: {
      type: new Schema<MultiplayerRematchState>(
        {
          requestedBy: {
            type: [String],
            enum: ["white", "black"],
            default: [],
          },
        },
        { _id: false },
      ),
      default: null,
    },
    takeback: {
      type: new Schema<MultiplayerTakebackState>(
        {
          requestedBy: {
            type: String,
            enum: ["white", "black", null],
            default: null,
          },
          declinedCount: {
            type: Schema.Types.Mixed,
            default: { white: 0, black: 0 },
          },
        },
        { _id: false },
      ),
      default: null,
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
    timeControl: {
      type: new Schema(
        {
          initialMs: { type: Number, required: true },
          incrementMs: { type: Number, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    clockMs: {
      type: new Schema(
        {
          white: { type: Number, required: true },
          black: { type: Number, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    lastMoveAt: {
      type: Date,
      default: null,
    },
    firstMoveDeadline: {
      type: Date,
      default: null,
    },
    ratingBefore: {
      type: new Schema(
        {
          white: { type: Number, required: true },
          black: { type: Number, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    ratingAfter: {
      type: new Schema(
        {
          white: { type: Number, required: true },
          black: { type: Number, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    tournamentId: {
      type: String,
      default: null,
      sparse: true,
      index: true,
    },
    tournamentMatchId: {
      type: String,
      default: null,
      sparse: true,
    },
    /** Auto-delete waiting rooms that have gone stale. Null for active/finished rooms. */
    staleAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

GameRoomSchema.index({ "players.playerId": 1, status: 1, updatedAt: -1 });
GameRoomSchema.index({ tournamentId: 1, tournamentMatchId: 1 }, { sparse: true });
GameRoomSchema.index({ staleAt: 1 }, { expireAfterSeconds: 0, sparse: true });

const GameRoom = models.GameRoom || model<IGameRoom>("GameRoom", GameRoomSchema);

export default GameRoom;
