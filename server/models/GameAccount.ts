import { Document, Schema, model, models } from "mongoose";

export interface IGameAccount extends Document {
  email: string;
  passwordHash: string;
  displayName: string;
  profilePicture?: string;
  createdAt: Date;
  updatedAt: Date;
}

const GameAccountSchema = new Schema<IGameAccount>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    profilePicture: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const GameAccount =
  models.GameAccount ||
  model<IGameAccount>("GameAccount", GameAccountSchema);

export default GameAccount;
