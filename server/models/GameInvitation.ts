import { Document, Schema, model, models } from "mongoose";
import { MultiplayerRoomType } from "../../shared/src";

export type GameInvitationStatus = "pending" | "accepted" | "revoked" | "declined" | "expired";

export interface IGameInvitation extends Document {
  gameId: string;
  roomType: MultiplayerRoomType;
  senderId: Schema.Types.ObjectId;
  recipientId: Schema.Types.ObjectId;
  status: GameInvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GameInvitationSchema = new Schema<IGameInvitation>(
  {
    gameId: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    roomType: {
      type: String,
      required: true,
      enum: ["direct", "matchmaking"],
      default: "direct",
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "GameAccount",
      required: true,
      index: true,
    },
    recipientId: {
      type: Schema.Types.ObjectId,
      ref: "GameAccount",
      required: true,
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: ["pending", "accepted", "revoked", "declined", "expired"],
      default: "pending",
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

GameInvitationSchema.index(
  { gameId: 1, senderId: 1, recipientId: 1, status: 1 },
  { unique: false },
);

const GameInvitation =
  models.GameInvitation || model<IGameInvitation>("GameInvitation", GameInvitationSchema);

export default GameInvitation;
