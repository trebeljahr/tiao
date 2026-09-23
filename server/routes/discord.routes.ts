import type { KeyObject } from "node:crypto";
import express, { type Request, type Response, Router } from "express";
import {
  type DiscordDataSource,
  type DiscordInteraction,
  dispatchInteraction,
} from "../discord/commands";
import { discordConfigFromEnv } from "../discord/config";
import { createMongoDataSource } from "../discord/dataSource";
import { parseDiscordPublicKey, verifyDiscordSignature } from "../discord/verify";
import { createLogger } from "../lib/logger";

const log = createLogger("discord");

export interface DiscordRouterOptions {
  publicKey: KeyObject;
  dataSource: DiscordDataSource;
}

// ---------------------------------------------------------------------------
// POST /interactions — Discord interactions endpoint
// ---------------------------------------------------------------------------
//
// Discord POSTs every slash command here and expects a reply within 3s.
// The body is parsed as a raw Buffer because the Ed25519 signature covers
// the exact bytes Discord sent, prefixed with the timestamp header; any
// re-serialisation would break verification. The router therefore brings
// its own body parser and must be mounted BEFORE the global express.json().

export function createDiscordRouter(options: DiscordRouterOptions | null): Router {
  const router = Router();

  if (!options) {
    // Not configured: behave as if the route doesn't exist.
    router.post("/interactions", (_req: Request, res: Response) => {
      res.status(404).json({ message: "Not found." });
    });
    return router;
  }

  const { publicKey, dataSource } = options;

  router.post(
    "/interactions",
    express.raw({ type: "application/json", limit: "64kb" }),
    async (req: Request, res: Response) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const signature = req.header("x-signature-ed25519");
      const timestamp = req.header("x-signature-timestamp");

      if (!verifyDiscordSignature(publicKey, signature, timestamp, rawBody)) {
        return res.status(401).json({ message: "Invalid request signature." });
      }

      let interaction: DiscordInteraction;
      try {
        interaction = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ message: "Malformed interaction body." });
      }

      try {
        const response = await dispatchInteraction(interaction, dataSource);
        return res.json(response);
      } catch (error) {
        log.error("interaction failed", error, { command: interaction.data?.name });
        return res.status(500).json({ message: "Unable to handle interaction." });
      }
    },
  );

  return router;
}

function buildDefaultRouter(): Router {
  const config = discordConfigFromEnv();
  if (!config) return createDiscordRouter(null);

  let publicKey: KeyObject;
  try {
    publicKey = parseDiscordPublicKey(config.publicKey);
  } catch (error) {
    log.error("ignoring DISCORD_PUBLIC_KEY", error);
    return createDiscordRouter(null);
  }

  return createDiscordRouter({
    publicKey,
    dataSource: createMongoDataSource({ puzzleFile: config.puzzleFile }),
  });
}

export default buildDefaultRouter();
