import { Document, Schema, model, models } from "mongoose";

export interface IRatingEntry {
  elo: number;
  gamesPlayed: number;
}

export interface IGameAccount extends Document {
  email: string;
  passwordHash: string;
  displayName: string;
  profilePicture?: string;
  friends: Schema.Types.ObjectId[];
  receivedFriendRequests: Schema.Types.ObjectId[];
  sentFriendRequests: Schema.Types.ObjectId[];
  hasSeenTutorial: boolean;
  /** Badge IDs the player has unlocked. */
  badges: string[];
  /** Which badge(s) the player chose to display (empty = hidden). */
  activeBadges: string[];
  rating: {
    overall: IRatingEntry;
  };
  createdAt: Date;
  updatedAt: Date;
}

const GameAccountSchema = new Schema<IGameAccount>(
  {
    email: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      sparse: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    profilePicture: {
      type: String,
      trim: true,
    },
    friends: [
      {
        type: Schema.Types.ObjectId,
        ref: "GameAccount",
        default: [],
      },
    ],
    receivedFriendRequests: [
      {
        type: Schema.Types.ObjectId,
        ref: "GameAccount",
        default: [],
      },
    ],
    sentFriendRequests: [
      {
        type: Schema.Types.ObjectId,
        ref: "GameAccount",
        default: [],
      },
    ],
    hasSeenTutorial: {
      type: Boolean,
      default: false,
    },
    badges: {
      type: [String],
      default: [],
    },
    activeBadges: {
      type: [String],
      default: [],
    },
    rating: {
      overall: {
        elo: { type: Number, default: 1500 },
        gamesPlayed: { type: Number, default: 0 },
      },
    },
  },
  {
    timestamps: true,
  }
);

GameAccountSchema.index({ friends: 1 });
GameAccountSchema.index({ receivedFriendRequests: 1 });
GameAccountSchema.index({ sentFriendRequests: 1 });

const GameAccount =
  models.GameAccount ||
  model<IGameAccount>("GameAccount", GameAccountSchema);

export default GameAccount;
