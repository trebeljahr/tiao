import { type Document, model, models, Schema } from "mongoose";

/**
 * Async "Download my data" GDPR art. 15 export job.
 *
 * One document per request. Lifecycle:
 *
 *   pending  — just enqueued, worker hasn't picked it up yet
 *   running  — worker is actively collecting data
 *   ready    — ZIP uploaded to S3, download URL available until expiresAt
 *   failed   — worker threw; `error` contains the message
 *
 * `downloadKey` is the S3 object key. When status is `ready` the route
 * handler mints a fresh presigned URL on demand rather than storing one
 * — presigned URLs expire and we want a reusable row.
 *
 * `expiresAt` is enforced by a daily cleanup job (see
 * server/scripts/cleanupExpiredExports.ts). MongoDB also has a TTL index
 * as a belt-and-braces fallback so stale rows can't pile up even if the
 * cleanup cron is broken.
 */

export type UserExportStatus = "pending" | "running" | "ready" | "failed";

export interface IUserExportRequest extends Document {
  /** Owning account id (string form, matching GameAccount._id). */
  accountId: string;
  status: UserExportStatus;
  /** S3 object key — only set when status === "ready". */
  downloadKey?: string;
  /** Human-readable failure reason — only set when status === "failed". */
  error?: string;
  /** When the ZIP (and this row) should be dropped. */
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserExportRequestSchema = new Schema<IUserExportRequest>(
  {
    accountId: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: ["pending", "running", "ready", "failed"],
      default: "pending",
      index: true,
    },
    downloadKey: {
      type: String,
      required: false,
    },
    error: {
      type: String,
      required: false,
    },
    expiresAt: {
      type: Date,
      required: true,
      // TTL index: Mongo will sweep ready/failed rows automatically once
      // they pass expiresAt. The background cleanup job also hits S3 so
      // the ZIP is deleted before the row disappears.
      index: { expires: 0 },
    },
  },
  { timestamps: true },
);

const UserExportRequest =
  models.UserExportRequest ||
  model<IUserExportRequest>("UserExportRequest", UserExportRequestSchema);

export default UserExportRequest;
