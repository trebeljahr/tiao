import express from "express";
import { requireAccount } from "../auth/sessionHelper";
import * as steam from "../auth/steamAccount";
import { authRateLimiter } from "../middleware/rateLimiter";

export function createSteamAuthRouter(
  deps = {
    verify: steam.verifySteamAuthTicket,
    find: steam.findSteamAccount,
    create: steam.createSteamAccount,
    link: steam.linkSteamAccount,
    mint: steam.mintSteamDesktopSession,
    requireAccount,
  },
) {
  const router = express.Router();
  router.post("/session", authRateLimiter, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const { action, ticket, appId, username } = req.body ?? {};
      if (!["check", "create", "link"].includes(action)) {
        return res.status(400).json({ code: "BAD_REQUEST", message: "Invalid sign-in action." });
      }
      // Linking needs both proofs. Never infer the target from an email, name,
      // client-supplied user ID, SteamID, or library owner's SteamID.
      const target = action === "link" ? await deps.requireAccount(req, res) : null;
      if (action === "link" && !target) return;
      const steamId = await deps.verify(ticket, appId);
      const account =
        action === "link"
          ? await deps.link(steamId, target!.id)
          : action === "create"
            ? await deps.create(steamId, username)
            : await deps.find(steamId);
      if (!account) return res.json({ status: "needs_setup" });
      return res.json({ status: "signed_in", ...(await deps.mint(account.id)) });
    } catch (error) {
      if (error instanceof steam.SteamAccountError) {
        return res.status(error.status).json({ code: error.code, message: error.message });
      }
      // Do not log request bodies or ticket-bearing upstream URLs.
      console.error("[steam-auth] Account operation failed");
      return res.status(503).json({
        code: "STEAM_AUTH_UNAVAILABLE",
        message: "Steam sign-in is unavailable. Please try again.",
      });
    }
  });
  return router;
}
export default createSteamAuthRouter();
