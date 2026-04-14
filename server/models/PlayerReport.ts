import { Document, Schema, model, models } from "mongoose";

export const REPORT_REASONS = [
  "offensive_username",
  "inappropriate_profile_picture",
  "harassment",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export interface IPlayerReport extends Document {
  reporterId: Schema.Types.ObjectId;
  reportedId: Schema.Types.ObjectId;
  reason: ReportReason;
  details?: string;
  createdAt: Date;
}

const PlayerReportSchema = new Schema<IPlayerReport>(
  {
    reporterId: {
      type: Schema.Types.ObjectId,
      ref: "GameAccount",
      required: true,
    },
    reportedId: {
      type: Schema.Types.ObjectId,
      ref: "GameAccount",
      required: true,
    },
    reason: {
      type: String,
      enum: REPORT_REASONS,
      required: true,
    },
    details: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  },
);

// One report per reporter per reason per reported player
PlayerReportSchema.index({ reporterId: 1, reportedId: 1, reason: 1 }, { unique: true });
// Fast lookup of all reports against a player
PlayerReportSchema.index({ reportedId: 1 });

const PlayerReport =
  models.PlayerReport || model<IPlayerReport>("PlayerReport", PlayerReportSchema);

export default PlayerReport;
