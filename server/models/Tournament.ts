import { Document, Schema, model, models } from "mongoose";
import type {
  TournamentStatus,
  TournamentSettings,
  TournamentParticipant,
  TournamentRound,
  TournamentGroup,
} from "../../shared/src";

export interface ITournament extends Document {
  tournamentId: string;
  name: string;
  description?: string;
  creatorId: string;
  creatorDisplayName: string;
  status: TournamentStatus;
  settings: TournamentSettings;
  participants: TournamentParticipant[];
  rounds: TournamentRound[];
  groups: TournamentGroup[];
  knockoutRounds: TournamentRound[];
  featuredMatchId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const _TournamentMatchPlayerSchema = new Schema(
  {
    playerId: { type: String, required: true },
    displayName: { type: String, required: true },
    seed: { type: Number, required: true },
  },
  { _id: false },
);

const TournamentMatchSchema = new Schema(
  {
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
  { _id: false },
);

const TournamentRoundSchema = new Schema(
  {
    roundIndex: { type: Number, required: true },
    label: { type: String, required: true },
    matches: { type: [TournamentMatchSchema], default: [] },
    status: {
      type: String,
      required: true,
      enum: ["pending", "active", "finished"],
      default: "pending",
    },
  },
  { _id: false },
);

const TournamentGroupStandingSchema = new Schema(
  {
    playerId: { type: String, required: true },
    displayName: { type: String, required: true },
    seed: { type: Number, required: true },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    scoreDiff: { type: Number, default: 0 },
  },
  { _id: false },
);

const TournamentGroupSchema = new Schema(
  {
    groupId: { type: String, required: true },
    label: { type: String, required: true },
    participantIds: { type: [String], default: [] },
    rounds: { type: [TournamentRoundSchema], default: [] },
    standings: { type: [TournamentGroupStandingSchema], default: [] },
  },
  { _id: false },
);

const NoShowPolicySchema = new Schema(
  {
    type: { type: String, required: true, enum: ["auto-forfeit", "admin-decides"] },
    timeoutMs: { type: Number },
  },
  { _id: false },
);

const TournamentSettingsSchema = new Schema(
  {
    format: {
      type: String,
      required: true,
      enum: ["round-robin", "single-elimination", "groups-knockout"],
    },
    timeControl: { type: Schema.Types.Mixed, default: null },
    scheduling: {
      type: String,
      required: true,
      enum: ["simultaneous", "time-window"],
      default: "simultaneous",
    },
    noShow: { type: NoShowPolicySchema, required: true },
    visibility: {
      type: String,
      required: true,
      enum: ["public", "private"],
      default: "public",
    },
    minPlayers: { type: Number, required: true, default: 4 },
    maxPlayers: { type: Number, required: true, default: 128 },
    groupSize: { type: Number },
    advancePerGroup: { type: Number },
    inviteCode: { type: String },
  },
  { _id: false },
);

const TournamentParticipantSchema = new Schema(
  {
    playerId: { type: String, required: true },
    displayName: { type: String, required: true },
    seed: { type: Number, required: true },
    status: {
      type: String,
      required: true,
      enum: ["registered", "eliminated", "active", "winner"],
      default: "registered",
    },
  },
  { _id: false },
);

const TournamentSchema = new Schema<ITournament>(
  {
    tournamentId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    creatorId: {
      type: String,
      required: true,
      index: true,
    },
    creatorDisplayName: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: ["draft", "registration", "active", "finished", "cancelled"],
      default: "draft",
    },
    settings: {
      type: TournamentSettingsSchema,
      required: true,
    },
    participants: {
      type: [TournamentParticipantSchema],
      default: [],
    },
    rounds: {
      type: [TournamentRoundSchema],
      default: [],
    },
    groups: {
      type: [TournamentGroupSchema],
      default: [],
    },
    knockoutRounds: {
      type: [TournamentRoundSchema],
      default: [],
    },
    featuredMatchId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

TournamentSchema.index({ status: 1, "settings.visibility": 1, createdAt: -1 });
TournamentSchema.index({ "participants.playerId": 1 });

const Tournament = models.Tournament || model<ITournament>("Tournament", TournamentSchema);

export default Tournament;
