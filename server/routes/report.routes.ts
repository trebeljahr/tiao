import express, { Request, Response } from "express";
import { Types } from "mongoose";
import GameAccount from "../models/GameAccount";
import PlayerReport, { REPORT_REASONS, type ReportReason } from "../models/PlayerReport";
import { requireAccount, requireAdmin } from "../auth/sessionHelper";
import { handleRouteError } from "../error-handling/routeError";
import { sendModerationAlert } from "../auth/email";

const REPORT_THRESHOLD = 5;

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /report — submit a player report
// ---------------------------------------------------------------------------

router.post("/report", async (req: Request, res: Response) => {
  const account = await requireAccount(req, res);
  if (!account) return;

  const { reportedId, reason, details } = req.body as {
    reportedId?: string;
    reason?: string;
    details?: string;
  };

  if (!reportedId || !reason) {
    return res
      .status(400)
      .json({ code: "VALIDATION_ERROR", message: "reportedId and reason are required." });
  }

  if (!REPORT_REASONS.includes(reason as ReportReason)) {
    return res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid report reason." });
  }

  if (String(account._id) === reportedId) {
    return res
      .status(400)
      .json({ code: "VALIDATION_ERROR", message: "You cannot report yourself." });
  }

  if (!Types.ObjectId.isValid(reportedId)) {
    return res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid player ID." });
  }

  try {
    const reported = await GameAccount.findById(reportedId);
    if (!reported) {
      return res.status(404).json({ code: "NOT_FOUND", message: "Player not found." });
    }

    // Insert report — unique index will reject duplicates
    try {
      await PlayerReport.create({
        reporterId: account._id,
        reportedId: new Types.ObjectId(reportedId),
        reason,
        details: reason === "other" ? details?.slice(0, 500) : undefined,
      });
    } catch (err: any) {
      if (err.code === 11000) {
        return res.status(409).json({
          code: "DUPLICATE_REPORT",
          message: "You have already reported this player for this reason.",
        });
      }
      throw err;
    }

    // Atomically increment reportCount
    const updated = await GameAccount.findByIdAndUpdate(
      reportedId,
      { $inc: { reportCount: 1 } },
      { new: true },
    );

    // Auto-flag and email when threshold is reached
    if (updated && updated.reportCount >= REPORT_THRESHOLD && !updated.flaggedForReview) {
      updated.flaggedForReview = true;
      await updated.save();

      // Fire-and-forget email — don't let email failure block the response
      sendModerationAlert(updated.displayName, updated.reportCount).catch((err) => {
        console.error("[report] Failed to send moderation alert:", err);
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return handleRouteError(res, error, "Unable to submit report right now.", req);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/reports — list flagged players
// ---------------------------------------------------------------------------

router.get("/admin/reports", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const flagged = await GameAccount.find(
      { flaggedForReview: true },
      { displayName: 1, profilePicture: 1, reportCount: 1, flaggedForReview: 1 },
    )
      .sort({ reportCount: -1 })
      .limit(100)
      .lean();

    const players = flagged.map((a: any) => ({
      playerId: String(a._id),
      displayName: a.displayName,
      profilePicture: a.profilePicture,
      reportCount: a.reportCount,
    }));

    return res.status(200).json({ players });
  } catch (error) {
    return handleRouteError(res, error, "Unable to list flagged players.", req);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/reports/:playerId — get all reports for a player
// ---------------------------------------------------------------------------

router.get("/admin/reports/:playerId", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { playerId } = req.params;
  if (!Types.ObjectId.isValid(playerId as string)) {
    return res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid player ID." });
  }

  try {
    const reports = await PlayerReport.find({ reportedId: playerId })
      .sort({ createdAt: -1 })
      .lean();

    // Resolve reporter display names
    const reporterIds = [...new Set(reports.map((r: any) => String(r.reporterId)))];
    const reporters = await GameAccount.find(
      { _id: { $in: reporterIds } },
      { displayName: 1 },
    ).lean();
    const reporterMap = new Map(reporters.map((r: any) => [String(r._id), r.displayName]));

    const result = reports.map((r: any) => ({
      id: String(r._id),
      reporterName: reporterMap.get(String(r.reporterId)) ?? "Unknown",
      reason: r.reason,
      details: r.details,
      createdAt: r.createdAt,
    }));

    return res.status(200).json({ reports: result });
  } catch (error) {
    return handleRouteError(res, error, "Unable to fetch reports.", req);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/reports/:playerId/dismiss — clear flaggedForReview
// ---------------------------------------------------------------------------

router.post("/admin/reports/:playerId/dismiss", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { playerId } = req.params;
  if (!Types.ObjectId.isValid(playerId as string)) {
    return res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid player ID." });
  }

  try {
    await GameAccount.findByIdAndUpdate(playerId, {
      flaggedForReview: false,
      reportCount: 0,
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    return handleRouteError(res, error, "Unable to dismiss reports.", req);
  }
});

export default router;
