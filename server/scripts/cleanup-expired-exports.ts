/**
 * Daily cleanup of expired "Download my data" exports.
 *
 * Run from a cron / systemd timer / GitHub Actions schedule once a
 * day. Walks every UserExportRequest row whose expiresAt has passed,
 * deletes the S3 object, then removes the row.
 *
 * The row itself also has a TTL index on expiresAt, so Mongo will
 * sweep stale rows even if this script is never run — but the TTL
 * index doesn't touch S3, so the files would linger until someone
 * ran a manual cleanup. That's why we do both: the TTL index is the
 * failsafe, this script is the primary path.
 *
 * Usage:
 *   cd server
 *   npx tsx scripts/cleanup-expired-exports.ts
 *
 * Safe to run multiple times; idempotent.
 */

import "dotenv/config";
import dotenv from "dotenv";

dotenv.config({ path: ".env.development" });

import mongoose from "mongoose";
import { MONGODB_URI } from "../config/envVars";
import UserExportRequest from "../models/UserExportRequest";
import { deleteExport } from "../routes/dataExportService";

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.info(`[cleanup-exports] Connected to ${mongoose.connection.db?.databaseName}`);

  const expired = await UserExportRequest.find({ expiresAt: { $lt: new Date() } }).lean();
  console.info(`[cleanup-exports] Found ${expired.length} expired export(s)`);

  let deleted = 0;
  for (const row of expired) {
    try {
      await deleteExport(String(row._id));
      deleted++;
    } catch (err) {
      console.error(`[cleanup-exports] Failed to delete ${row._id}:`, err);
    }
  }

  console.info(`[cleanup-exports] Deleted ${deleted}/${expired.length} export(s)`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[cleanup-exports] Fatal error:", err);
  process.exit(1);
});
