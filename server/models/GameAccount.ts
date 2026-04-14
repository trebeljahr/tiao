import { Document, Schema, model, models } from "mongoose";

export interface IRatingEntry {
  elo: number;
  gamesPlayed: number;
}

export interface ISubscription {
  subscriptionId: string;
  badgeId: string;
  status: "active" | "past_due" | "canceled";
  currentPeriodEnd: Date;
}

export interface IGameAccount extends Document {
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
  /** Board theme IDs the player has been granted access to. */
  unlockedThemes: string[];
  /** Whether this account has admin privileges. */
  isAdmin: boolean;
  /** Denormalized count of reports filed against this account. */
  reportCount: number;
  /** Set to true when reportCount reaches the moderation threshold. */
  flaggedForReview: boolean;
  /** Short user-written bio for their public profile. */
  bio: string;
  /** Stripe customer ID for this account. */
  stripeCustomerId?: string;
  /** Active Stripe subscriptions granting badges. */
  activeSubscriptions: ISubscription[];
  rating: {
    overall: IRatingEntry;
  };
  createdAt: Date;
  updatedAt: Date;
}

const GameAccountSchema = new Schema<IGameAccount>(
  {
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
    unlockedThemes: {
      type: [String],
      default: [],
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    reportCount: {
      type: Number,
      default: 0,
    },
    flaggedForReview: {
      type: Boolean,
      default: false,
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    stripeCustomerId: {
      type: String,
    },
    activeSubscriptions: {
      type: [
        {
          subscriptionId: { type: String, required: true },
          badgeId: { type: String, required: true },
          status: { type: String, enum: ["active", "past_due", "canceled"], default: "active" },
          currentPeriodEnd: { type: Date, required: true },
        },
      ],
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
  },
);

GameAccountSchema.index({ friends: 1 });
GameAccountSchema.index({ receivedFriendRequests: 1 });
GameAccountSchema.index({ sentFriendRequests: 1 });

const GameAccount = models.GameAccount || model<IGameAccount>("GameAccount", GameAccountSchema);

export default GameAccount;
