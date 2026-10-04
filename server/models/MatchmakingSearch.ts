import { model, models, Schema } from "mongoose";

/**
 * Durable matchmaking intent. A search id may resume after socket or Redis
 * loss while it is active; once a newer search of the same account claims the
 * queue, the older id is superseded permanently. A Redis-only pointer would be
 * lost on Redis restart and let an old tab resurrect its search.
 */
export type MatchmakingSearchStatus = "active" | "superseded";

export interface PersistedMatchmakingSearch {
  _id: string;
  playerId: string;
  /** Per-account claim order; a delayed writer cannot supersede a newer claim. */
  seq: number;
  timeControl: { initialMs: number; incrementMs: number } | null;
  status: MatchmakingSearchStatus;
  supersededBy: string | null;
  createdAt: Date;
}

const MatchmakingSearchSchema = new Schema<PersistedMatchmakingSearch>(
  {
    _id: { type: String, required: true },
    playerId: { type: String, required: true },
    seq: { type: Number, required: true },
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
    status: { type: String, required: true, enum: ["active", "superseded"], default: "active" },
    supersededBy: { type: String, default: null },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

MatchmakingSearchSchema.index({ playerId: 1, seq: 1 }, { unique: true });
MatchmakingSearchSchema.index({ playerId: 1, status: 1 });
// Tombstones must outlive any browser tab that could still hold the old id.
MatchmakingSearchSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const MatchmakingSearch =
  models.MatchmakingSearch ||
  model<PersistedMatchmakingSearch>("MatchmakingSearch", MatchmakingSearchSchema);
