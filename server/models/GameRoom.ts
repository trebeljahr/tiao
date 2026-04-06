import { Document, Schema, model, models } from "mongoose";
import type {
  GameState,
  MultiplayerRematchState,
  MultiplayerTakebackState,
  MultiplayerSeatAssignments,
  MultiplayerRoomType,
  MultiplayerStatus,
} from "../../shared/src";

/**
 * Slim stored identity — only playerId, kind, and displayName are persisted.
 * Full profile data (profilePicture, rating, badges, etc.) is resolved from
 * the player identity cache at read time.
 */
const PlayerIdentitySchema = new Schema(
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
  },
  {
    _id: false,
  },
);

export type RatingStatus = "pending" | "completed" | "skipped" | null;

export interface IGameRoom extends Document {
  roomId: string;
  roomType: MultiplayerRoomType;
  status: MultiplayerStatus;
  state: GameState;
  moveHistory: unknown;
  rematch: MultiplayerRematchState | null;
  takeback: MultiplayerTakebackState | null;
  seats: MultiplayerSeatAssignments;
  timeControl: { initialMs: number; incrementMs: number } | null;
  clockMs: { white: number; black: number } | null;
  lastMoveAt: Date | null;
  firstMoveDeadline: Date | null;
  ratingBefore: { white: number; black: number } | null;
  ratingAfter: { white: number; black: number } | null;
  ratingStatus: RatingStatus;
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
    /** Compact move history, stored separately from state so the state field is fixed-size. */
    moveHistory: {
      type: Schema.Types.Mixed,
      default: null,
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
    ratingStatus: {
      type: String,
      enum: ["pending", "completed", "skipped", null],
      default: null,
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

// Player-centric queries via seats (replaces old players.playerId index)
GameRoomSchema.index({ "seats.white.playerId": 1, status: 1, updatedAt: -1 });
GameRoomSchema.index({ "seats.black.playerId": 1, status: 1, updatedAt: -1 });
GameRoomSchema.index({ tournamentId: 1, tournamentMatchId: 1 }, { sparse: true });
GameRoomSchema.index({ staleAt: 1 }, { expireAfterSeconds: 0, sparse: true });
// Active timed games for clock tick processing
GameRoomSchema.index(
  { status: 1, clockMs: 1, lastMoveAt: 1 },
  { partialFilterExpression: { status: "active" } },
);

const GameRoom = models.GameRoom || model<IGameRoom>("GameRoom", GameRoomSchema);

export default GameRoom;
