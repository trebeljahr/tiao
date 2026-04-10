/**
 * "Download my data" GDPR art. 15 export worker.
 *
 * Architecture:
 *   - POST /account/export-request creates a `UserExportRequest` row in
 *     status "pending" and kicks off `runExport(requestId)` via
 *     setImmediate so the HTTP response returns right away.
 *   - runExport collects everything the user is entitled to see about
 *     themselves — account profile, finished games, tournaments, friends,
 *     invitations, subscriptions, badges — serialises it to a pretty-
 *     printed JSON file, and uploads it to S3 under a non-guessable key.
 *   - The row flips to "ready" with the S3 key; GET /account/export/:id
 *     mints a fresh presigned URL on demand for the authenticated owner.
 *   - A daily cleanup job (cleanupExpiredExports.ts) deletes the S3
 *     object and the Mongo row once `expiresAt` passes. A TTL index on
 *     the row is the fallback if the cron breaks.
 *
 * Notes:
 *   - No background queue dependency: at tiao's scale a single-process
 *     in-memory fire-and-forget is fine. If you ever horizontally scale
 *     the API, move this to BullMQ + Redis.
 *   - Output is a single JSON file, not a ZIP. Avoids pulling in an
 *     archiver dependency for a feature that will run <100 times/year.
 *     Plain JSON is trivially parseable by users and regulators alike.
 *   - The export intentionally does NOT include the OpenPanel event
 *     history. Those events are tied to the profileId and can be
 *     exported from the OpenPanel dashboard separately if a regulator
 *     ever asks. Including them here would require a second network
 *     round-trip per request and would bloat the JSON for little value.
 */

import crypto from "crypto";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import GameAccount from "../models/GameAccount";
import GameInvitation from "../models/GameInvitation";
import GameRoom from "../models/GameRoom";
import type { IUserExportRequest } from "../models/UserExportRequest";
import UserExportRequest from "../models/UserExportRequest";
import Tournament from "../models/Tournament";
import { s3Client } from "../config/s3Client";
import { BUCKET_NAME } from "../config/envVars";
import { gameService } from "../game/gameService";

/**
 * Push an `export-update` message to this user's lobby socket(s) so
 * the Settings page can flip the card from "preparing" to "ready"
 * without polling. Fire-and-forget — the lobby socket may not be open
 * (offline users), in which case the next manual refresh picks up the
 * state from the REST endpoint instead. The shape matches what
 * listExportsForAccount returns for a single row so the client can
 * splice it straight into local state.
 */
function broadcastExportUpdate(request: IUserExportRequest): void {
  try {
    gameService.broadcastLobby(request.accountId, {
      type: "export-update",
      export: {
        id: String(request._id),
        status: request.status,
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
        error: request.error ?? null,
      },
    });
  } catch (err) {
    // Broadcast is best-effort — never let it derail the worker.
    console.warn("[export] Failed to broadcast export-update:", err);
  }
}

/**
 * How long a finished export stays downloadable before the cleanup
 * cron wipes it from S3 and Mongo. 7 days is long enough for a slow
 * user and short enough that we don't accumulate stale PII.
 */
const EXPORT_TTL_DAYS = 7;
const EXPORT_TTL_MS = EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * How long a presigned download URL is valid once minted. Short enough
 * that a leaked URL in browser history isn't catastrophic, long enough
 * that "click Download and walk away for 10 minutes" still works.
 */
const PRESIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * Rate limit: at most one *active* (pending/running/ready) request per
 * account. Forces users to delete or wait out their previous export
 * before creating a new one, prevents abuse, and avoids piling up S3
 * objects for someone who just keeps clicking Download.
 */
export async function getActiveExportForAccount(accountId: string) {
  return UserExportRequest.findOne({
    accountId,
    status: { $in: ["pending", "running", "ready"] },
  });
}

export async function listExportsForAccount(accountId: string) {
  return UserExportRequest.find({ accountId }).sort({ createdAt: -1 }).lean();
}

/**
 * Create a new export row and kick off the worker asynchronously.
 * Returns the persisted row so the route handler can respond with its
 * id immediately. Caller is responsible for rate-limit checks via
 * getActiveExportForAccount beforehand.
 */
export async function enqueueExport(accountId: string) {
  const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);
  const request = await UserExportRequest.create({
    accountId,
    status: "pending",
    expiresAt,
  });

  // Tell the lobby socket about the new row so the Settings page can
  // splice it into state without needing a REST refetch. The client
  // already gets the row in the POST response, so this broadcast is
  // mainly for *other* tabs of the same account that already had the
  // Settings page open.
  broadcastExportUpdate(request);

  // Detach from the request lifecycle. Errors inside runExport are
  // caught there and persisted as status="failed" on the row — never
  // rethrown into this setImmediate callback so the event loop stays
  // clean.
  setImmediate(() => {
    void runExport(String(request._id)).catch((err) => {
      console.error("[export] Unhandled worker error:", err);
    });
  });

  return request;
}

/**
 * The worker itself. Runs detached; never throws. On failure, flips
 * the row to "failed" with a user-facing error message.
 */
async function runExport(requestId: string): Promise<void> {
  const request = await UserExportRequest.findById(requestId);
  if (!request) return;

  request.status = "running";
  await request.save();
  broadcastExportUpdate(request);

  try {
    const accountId = request.accountId;
    const payload = await collectUserData(accountId);
    const body = JSON.stringify(payload, null, 2);

    // Non-guessable key — `exports/<accountId>/<random>.json`. The
    // accountId prefix makes it easy to find all of one user's
    // exports during a manual cleanup or GDPR audit.
    const key = `exports/${accountId}/${crypto.randomUUID()}.json`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: "application/json",
        // Don't publish. Private by default; downloads happen via
        // short-lived presigned URLs only.
        ACL: "private",
      }),
    );

    request.downloadKey = key;
    request.status = "ready";
    await request.save();
    broadcastExportUpdate(request);
  } catch (err) {
    console.error("[export] Export generation failed for request", requestId, err);
    request.status = "failed";
    request.error = err instanceof Error ? err.message : "Unknown error";
    await request.save();
    broadcastExportUpdate(request);
  }
}

/**
 * Mint a short-lived presigned GET URL for a ready export. Throws if
 * the request isn't owned by the caller, isn't ready, or is expired —
 * route handler should 404 on any of these.
 */
export async function getExportDownloadUrl(
  requestId: string,
  accountId: string,
): Promise<string | null> {
  const request = await UserExportRequest.findById(requestId);
  if (!request) return null;
  if (request.accountId !== accountId) return null;
  if (request.status !== "ready" || !request.downloadKey) return null;
  if (request.expiresAt.getTime() < Date.now()) return null;

  return getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: request.downloadKey,
      ResponseContentDisposition: `attachment; filename="tiao-data-export.json"`,
    }),
    { expiresIn: PRESIGNED_URL_TTL_SECONDS },
  );
}

/**
 * Collect everything the user is entitled to receive under GDPR art.
 * 15 "right of access". Scoped to what's in our own databases —
 * Stripe data is *not* included because Stripe has its own data-
 * subject-access flow via their dashboard and including it here would
 * require a full API traversal on every export.
 */
async function collectUserData(accountId: string): Promise<Record<string, unknown>> {
  const [account, games, tournaments, sentInvites, receivedInvites] = await Promise.all([
    GameAccount.findById(accountId).lean(),
    GameRoom.find({
      status: "finished",
      $or: [{ "seats.white.playerId": accountId }, { "seats.black.playerId": accountId }],
    })
      .lean()
      .exec(),
    Tournament.find({ "participants.playerId": accountId }).lean().exec(),
    GameInvitation.find({ senderId: accountId }).lean().exec(),
    GameInvitation.find({ recipientId: accountId }).lean().exec(),
  ]);

  return {
    exported_at: new Date().toISOString(),
    format_version: 1,
    notice: [
      "This is a full export of your personal data held in Tiao's own database.",
      "Payment records are held by Stripe — use Stripe's customer portal to download those.",
      "Analytics events are held by OpenPanel — contact privacy@playtiao.com if you want those too.",
    ].join(" "),
    account: account ?? null,
    finished_games: games,
    tournaments: tournaments,
    sent_invitations: sentInvites,
    received_invitations: receivedInvites,
  };
}

/**
 * Delete S3 object + Mongo row for a single expired export. Safe to
 * call on any status. Called from the cleanup cron.
 */
export async function deleteExport(requestId: string): Promise<void> {
  const request = await UserExportRequest.findById(requestId);
  if (!request) return;
  if (request.downloadKey) {
    try {
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: request.downloadKey }),
      );
    } catch (err) {
      console.error("[export] Failed to delete S3 object", request.downloadKey, err);
    }
  }
  await UserExportRequest.deleteOne({ _id: request._id });
}
