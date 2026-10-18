/**
 * Per-link pages for the dynamic routes of the static web client.
 *
 * `/game/<id>`, `/profile/<name>`, `/tournament/<id>` and `/embed/game/<id>`
 * exist once in the export, baked with the `__spa__` placeholder. This
 * module decides which placeholder file a request needs and, for a page,
 * which title, description and preview image to write into it. The Worker
 * (index.mjs) does the I/O; everything here is pure so it unit-tests in
 * Node.
 *
 * `_redirects` cannot do this mapping: Cloudflare does not keep the file
 * order of its rules, and `/game/:id` also matches `/game/<id>.txt`.
 */

import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import es from "../messages/es.json" with { type: "json" };

export const SITE_URL = "https://playtiao.com";
export const LOCALES = ["en", "de", "es"];
export const DEFAULT_LOCALE = "en";
export const PLACEHOLDER = "__spa__";

/** Route prefixes whose next segment is the dynamic param. */
export const DYNAMIC_ROUTES = ["embed/game", "game", "profile", "tournament"];

const OG = { en: en.og, de: de.og, es: es.og };

const FORMAT_LABELS = {
  "round-robin": "Round Robin",
  elimination: "Single Elimination",
  "groups-knockout": "Groups + Knockout",
};

/**
 * `run_worker_first` patterns for wrangler.jsonc: the page and its RSC
 * payload (`/game/<id>`, `/game/<id>.txt`) reach the Worker; deeper paths
 * (segment prefetch files, the trailing-slash redirect) stay with
 * `_redirects`, which handles them unambiguously.
 */
export function runWorkerFirstPatterns() {
  const bases = ["", ...LOCALES.filter((l) => l !== DEFAULT_LOCALE).map((l) => `/${l}`)];
  const patterns = [];
  for (const base of bases)
    for (const route of DYNAMIC_ROUTES)
      patterns.push(`${base}/${route}/*`, `!${base}/${route}/*/*`);
  return patterns;
}

/**
 * The dynamic route a path names, or null.
 * `/de/game/ABC123.txt` → { locale: "de", route: "game", id: "ABC123", payload: true }
 */
export function parseDynamicPath(pathname) {
  const parts = pathname.split("/").slice(1);
  let locale = DEFAULT_LOCALE;
  if (LOCALES.includes(parts[0]) && parts[0] !== DEFAULT_LOCALE) locale = parts.shift();
  for (const route of DYNAMIC_ROUTES) {
    const prefix = route.split("/");
    if (parts.length !== prefix.length + 1) continue;
    if (!prefix.every((part, i) => parts[i] === part)) continue;
    let raw = parts[prefix.length];
    const payload = raw.endsWith(".txt");
    if (payload) raw = raw.slice(0, -4);
    let id;
    try {
      id = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!id) return null;
    return { locale, route, id, payload };
  }
  return null;
}

/** The asset path that serves a parsed request: the placeholder page or payload. */
export function placeholderPath({ locale, route, payload }) {
  const base = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
  return `${base}/${route}/${PLACEHOLDER}${payload ? ".txt" : ""}`;
}

/** Canonical URL of a dynamic page, as next-intl's `localePrefix: "as-needed"` writes it. */
export function pageUrl(locale, route, id) {
  const base = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
  return `${SITE_URL}${base}/${route}/${encodeURIComponent(id)}`;
}

/** Fill `{name}` placeholders of a message (the og namespace uses no plurals). */
export function format(message, values = {}) {
  return message.replace(/\{(\w+)\}/g, (match, key) =>
    values[key] === undefined ? match : String(values[key]),
  );
}

/** The public API path holding a route's preview data, or null. */
export function previewDataPath(route, id) {
  const value = encodeURIComponent(id);
  if (route === "game") return `/api/games/${value}/og`;
  if (route === "profile") return `/api/player/profile/${value}`;
  if (route === "tournament") return `/api/tournaments/${value}`;
  return null;
}

/** Where the game server renders a route's preview image. */
export function previewImageUrl(route, id) {
  return `${SITE_URL}/api/og/${route}/${encodeURIComponent(id)}.png`;
}

/**
 * Title, descriptions and image for one page. `data` is the API answer, or
 * null when it was missing or unavailable: the page then names only the id.
 * Mirrors the per-request metadata the Node server rendered before the
 * client became static files.
 */
export function previewFor({ locale, route, id }, data) {
  const t = OG[locale] ?? OG[DEFAULT_LOCALE];
  const image = previewImageUrl(route, id);
  if (route === "game") {
    const game = data;
    const code = id.toUpperCase();
    if (!game) {
      const title = format(t.gameTitle, { gameId: code });
      return { title, description: t.siteDescription, socialDescription: t.siteDescription, image };
    }
    const boardSize = game.boardSize ?? 19;
    const scoreToWin = game.scoreToWin ?? 10;
    let title;
    let socialDescription;
    if (game.status === "waiting") {
      const hostName = game.white || game.black || "Someone";
      const hostRating = game.whiteRating ?? game.blackRating;
      title = format(t.gameTitle, { gameId: code });
      socialDescription = format(t.gameWaiting, {
        host: hostRating ? `${hostName} (${hostRating})` : hostName,
      });
    } else {
      const white = game.white ?? "?";
      const black = game.black ?? "?";
      title = `${white} vs ${black}`;
      socialDescription =
        game.status === "active"
          ? format(t.gameActive, { white, black, boardSize })
          : format(t.gameFinished, {
              white,
              black,
              whiteScore: game.score?.white ?? 0,
              blackScore: game.score?.black ?? 0,
            });
    }
    const tc = game.timeControl;
    const description = tc
      ? format(t.gameDescriptionTimed, {
          boardSize,
          scoreToWin,
          timeControl: `${Math.floor(tc.initialMs / 60_000)}+${Math.round(tc.incrementMs / 1_000)}`,
        })
      : format(t.gameDescription, { boardSize, scoreToWin });
    return { title, description, socialDescription, image };
  }
  if (route === "profile") {
    const name = data?.profile?.displayName ?? id;
    const description = format(t.publicProfileDescription, { name });
    return {
      title: format(t.publicProfileTitle, { name }),
      description,
      socialDescription: description,
      image,
    };
  }
  if (route === "tournament") {
    const tournament = data?.tournament;
    if (!tournament) {
      return {
        title: t.tournamentsTitle,
        description: t.tournamentsDescription,
        socialDescription: t.tournamentsDescription,
        image,
      };
    }
    const format_ = tournament.settings?.format;
    const description = format(t.tournamentDetailDescription, {
      playerCount: tournament.participants?.length ?? 0,
      format: FORMAT_LABELS[format_] ?? format_ ?? "",
    });
    return {
      title: format(t.tournamentDetail, { name: tournament.name }),
      description,
      socialDescription: description,
      image,
    };
  }
  return null;
}
