import { Document, Schema, model, models } from "mongoose";
import type { TournamentMatchStatus } from "../../shared/src";

export interface ITournamentMatch extends Document {
  tournamentId: string;
  matchId: string;
  roundIndex: number;
  matchIndex: number;
  groupId?: string;
  players: Array<{ playerId: string; seed: number } | null>;
  roomId: string | null;
  winner: string | null;
  score: [number, number];
  status: TournamentMatchStatus;
  finishReason?: string | null;
  historyLength?: number;
  playerColors?: [string | null, string | null];
  scheduledAt?: string;
  deadline?: string;
}

const TournamentMatchSchema = new Schema<ITournamentMatch>(
  {
    tournamentId: { type: String, required: true },
    matchId: { type: String, required: true },
    roundIndex: { type: Number, required: true },
    matchIndex: { type: Number, required: true },
    groupId: { type: String },
    players: { type: [Schema.Types.Mixed], default: [null, null] },
    roomId: { type: String, default: null },
    winner: { type: String, default: null },
    score: { type: [Number], default: [0, 0] },
    status: {
      type: String,
      required: true,
      enum: ["pending", "active", "finished", "forfeit", "bye"],
      default: "pending",
    },
    finishReason: { type: String, enum: ["captured", "forfeit", "timeout"], default: null },
    historyLength: { type: Number },
    playerColors: { type: [String], default: undefined },
    scheduledAt: { type: String },
    deadline: { type: String },
  },
  { timestamps: true },
);

TournamentMatchSchema.index({ tournamentId: 1, matchId: 1 }, { unique: true });
TournamentMatchSchema.index({ tournamentId: 1, roundIndex: 1 });
TournamentMatchSchema.index({ roomId: 1 }, { sparse: true });

const TournamentMatchModel =
  models.TournamentMatch || model<ITournamentMatch>("TournamentMatch", TournamentMatchSchema);

export default TournamentMatchModel;
