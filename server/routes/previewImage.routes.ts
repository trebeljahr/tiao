import { type Request, type Response, Router } from "express";
import { createLogger } from "../lib/logger";
import {
  type GamePreview,
  isValidGameId,
  loadGamePreview,
  loadProfilePreview,
  loadTournamentPreview,
  type ProfilePreview,
  type TournamentPreview,
} from "../lib/previewData";
import { type PreviewCard, renderPreviewPng } from "../lib/previewImage";
import { previewImageRateLimiter } from "../middleware/rateLimiter";

const log = createLogger("preview-image");

// ---------------------------------------------------------------------------
// GET /og/{game,profile,tournament}/<id>.png — link-preview images
// ---------------------------------------------------------------------------
//
// The web client's Worker writes these URLs into the og:image / twitter:image
// tags of game, profile and tournament pages (client/worker/previews.mjs).
// An unknown id still gets a card (naming the id), as crawlers expect an
// image. Cloudflare caches the PNG at the edge for five minutes.

const FORMAT_LABELS: Record<string, string> = {
  "round-robin": "Round Robin",
  elimination: "Single Elimination",
  "groups-knockout": "Groups and Knockout",
};

export function gameCard(id: string, game: GamePreview | null): PreviewCard {
  const code = id.toUpperCase();
  const white = game?.white ?? "White";
  const black = game?.black ?? "Black";
  const boardSize = game?.boardSize ?? 19;
  const scoreToWin = game?.scoreToWin ?? 10;
  return {
    eyebrow: game?.status === "active" ? "Live match" : "Game invite",
    title: game ? `${white} vs ${black}` : `Tiao Game ${code}`,
    subtitle:
      game?.status === "finished"
        ? `Final score ${game.score?.white ?? 0}-${game.score?.black ?? 0}. Review this completed Tiao match.`
        : `Watch, join, or spectate this ${boardSize}x${boardSize} Tiao game. First to ${scoreToWin} captures wins.`,
    meta: [`Game ${code}`, `${boardSize}x${boardSize}`, `${scoreToWin} captures`],
  };
}

export function profileCard(username: string, profile: ProfilePreview | null): PreviewCard {
  const name = profile?.displayName ?? username;
  return {
    eyebrow: "Tiao player profile",
    title: `${name} on Tiao`,
    subtitle: "Public profile with rating, match history, badges, and recent games.",
    meta: [
      profile?.rating ? `${profile.rating} rating` : "Public profile",
      profile?.gamesPlayed ? `${profile.gamesPlayed} games` : "Match history",
      "Badges",
    ],
  };
}

export function tournamentCard(id: string, tournament: TournamentPreview | null): PreviewCard {
  const format = tournament
    ? (FORMAT_LABELS[tournament.format] ?? tournament.format)
    : "Tournament";
  const playerCount = tournament?.playerCount ?? 0;
  return {
    eyebrow: "Tiao tournament",
    title: tournament?.name ?? "Tiao Tournament",
    subtitle: tournament
      ? `${playerCount} players competing in a ${format} event. Join, follow standings, or review matches.`
      : "Join or follow a public Tiao tournament with standings, brackets, and match pages.",
    meta: [format, playerCount ? `${playerCount} players` : "Public event", id],
  };
}

export type PreviewLoaders = {
  game: typeof loadGamePreview;
  profile: typeof loadProfilePreview;
  tournament: typeof loadTournamentPreview;
};

const defaultLoaders: PreviewLoaders = {
  game: loadGamePreview,
  profile: loadProfilePreview,
  tournament: loadTournamentPreview,
};

/** The card for a request, or null when the kind or id is not one we draw. */
export async function cardFor(
  kind: string,
  id: string,
  loaders: PreviewLoaders = defaultLoaders,
): Promise<PreviewCard | null> {
  if (kind === "game") {
    if (!isValidGameId(id)) return null;
    return gameCard(id, await loaders.game(id));
  }
  if (kind === "profile") {
    if (!id || id.length > 64) return null;
    return profileCard(id, await loaders.profile(id));
  }
  if (kind === "tournament") {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
    return tournamentCard(id, await loaders.tournament(id));
  }
  return null;
}

/** Recent renders: a shared link is usually fetched by several crawlers at once. */
const CACHE_TTL_MS = 60_000;
const CACHE_LIMIT = 200;

export function createPreviewImageRouter(
  loaders: PreviewLoaders = defaultLoaders,
  render: typeof renderPreviewPng = renderPreviewPng,
) {
  const router = Router();
  const cache = new Map<string, { at: number; png: Buffer }>();

  router.get("/og/:kind/:file", previewImageRateLimiter, async (req: Request, res: Response) => {
    const kind = req.params.kind as string;
    const match = /^(.+)\.png$/.exec(req.params.file as string);
    if (!match) {
      res.status(404).json({ message: "Not found." });
      return;
    }
    const id = match[1];
    const key = `${kind}:${id.toLowerCase()}`;
    try {
      let entry = cache.get(key);
      if (!entry || Date.now() - entry.at > CACHE_TTL_MS) {
        const card = await cardFor(kind, id, loaders);
        if (!card) {
          res.status(404).json({ message: "Not found." });
          return;
        }
        entry = { at: Date.now(), png: await render(card) };
        cache.delete(key);
        cache.set(key, entry);
        if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      }
      res
        .status(200)
        .set({
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=300, s-maxage=300",
        })
        .send(entry.png);
    } catch (error) {
      log.warn("Preview image failed", { kind, error: String(error) });
      res.status(500).json({ message: "Unable to render the preview." });
    }
  });

  return router;
}

export default createPreviewImageRouter();
