import { Document, Schema, model, models } from "mongoose";
import { IdentityKind } from "../../shared/src";

export interface IGameSession extends Document {
  tokenDigest: string;
  playerId: string;
  kind: IdentityKind;
  displayName: string;
  email?: string;
  profilePicture?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GameSessionSchema = new Schema<IGameSession>(
  {
    tokenDigest: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    playerId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    kind: {
      type: String,
      required: true,
      enum: ["guest", "account"],
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    profilePicture: {
      type: String,
      trim: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: {
        expires: 0,
      },
    },
  },
  {
    timestamps: true,
  },
);

GameSessionSchema.index({ playerId: 1, expiresAt: -1 });

const GameSession = models.GameSession || model<IGameSession>("GameSession", GameSessionSchema);

export default GameSession;
