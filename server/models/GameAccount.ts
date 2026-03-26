import { Document, Schema, model, models } from "mongoose";

export interface IGameAccount extends Document {
  email: string;
  passwordHash: string;
  displayName: string;
  profilePicture?: string;
  friends: Schema.Types.ObjectId[];
  receivedFriendRequests: Schema.Types.ObjectId[];
  sentFriendRequests: Schema.Types.ObjectId[];
  hasSeenTutorial: boolean;
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
