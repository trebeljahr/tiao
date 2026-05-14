import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DESKTOP_SPA_PARAM_VALUE } from "@/lib/desktopPathParam";
import { localizedAlternates, OG_IMAGES } from "@/lib/metadata";
import { MultiplayerGamePage } from "@/views/MultiplayerGamePage";

type Props = { params: Promise<{ locale: string; gameId: string }> };

// Set by client/next.config.desktop.mjs at build time. Controls the
// two cross-build conditionals below so the same source file produces
// a full SSR-ready route for web AND a single placeholder HTML for
// the desktop static export.
const IS_DESKTOP_BUILD = process.env.NEXT_PUBLIC_PLATFORM === "desktop";

/** Server-side fetch to the backend for public game OG metadata.
 *  Skipped in dev to avoid blocking page loads with server-to-server HTTP. */
async function fetchGameOg(gameId: string) {
  if (process.env.NODE_ENV === "development") return null;
  const apiBase = process.env.API_URL || `http://127.0.0.1:${process.env.API_PORT || "5005"}`;
  try {
    const res = await fetch(`${apiBase}/api/games/${encodeURIComponent(gameId)}/og`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      gameId: string;
      status: string;
      boardSize: number;
      scoreToWin: number;
      score: { white: number; black: number };
      white: string | null;
      black: string | null;
      whiteRating?: number;
      blackRating?: number;
      timeControl: { initialMs: number; incrementMs: number } | null;
      roomType: string;
    };
  } catch {
    return null;
  }
}

/**
 * Desktop builds pre-render a single placeholder HTML file for this
 * dynamic route. The placeholder is served for every /game/<X> URL
 * by the Electron app:// protocol handler, and the view component
 * reads the real gameId from window.location.pathname at runtime
 * (see `resolveDynamicParam`).
 */
export function generateStaticParams() {
  if (IS_DESKTOP_BUILD) return [{ gameId: DESKTOP_SPA_PARAM_VALUE }];
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, gameId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });
  const pathname = `/game/${encodeURIComponent(gameId)}`;

  // Desktop static export: no per-game OG fetch. The Electron shell
  // serves one placeholder HTML for every /game/* URL, so per-game
  // metadata is both impossible (no unique file to attach it to) and
  // pointless (desktop app users don't share from the preview).
  if (IS_DESKTOP_BUILD) {
    const title = t("gameTitle", { gameId: "" }).trim() || "Tiao";
    const description = t("siteDescription");
    return {
      title,
      description,
      alternates: localizedAlternates(locale, pathname),
      openGraph: { title, description, images: OG_IMAGES },
    };
  }

  const game = await fetchGameOg(gameId);

  const id = gameId.toUpperCase();
  const fallbackTitle = t("gameTitle", { gameId: id });
  const fallbackDescription = t("siteDescription");

  if (!game) {
    return {
      title: fallbackTitle,
      description: fallbackDescription,
      alternates: localizedAlternates(locale, pathname),
      openGraph: { title: fallbackTitle, description: fallbackDescription, images: OG_IMAGES },
    };
  }

  let title: string;
  let description: string;

  const boardSize = game.boardSize ?? 19;
  const scoreToWin = game.scoreToWin ?? 10;

  if (game.status === "waiting") {
    const hostName = game.white || game.black || "Someone";
    const hostRating = game.whiteRating ?? game.blackRating;
    const host = hostRating ? `${hostName} (${hostRating})` : hostName;
    title = t("gameTitle", { gameId: id });
    description = t("gameWaiting", { host });
  } else if (game.status === "active") {
    const white = game.white ?? "?";
    const black = game.black ?? "?";
    title = `${white} vs ${black}`;
    description = t("gameActive", { white, black, boardSize: String(boardSize) });
  } else {
    const white = game.white ?? "?";
    const black = game.black ?? "?";
    title = `${white} vs ${black}`;
    description = t("gameFinished", {
      white,
      black,
      whiteScore: String(game.score?.white ?? 0),
      blackScore: String(game.score?.black ?? 0),
    });
  }

  const tc = game.timeControl;
  const tcLabel = tc
    ? `${Math.floor(tc.initialMs / 60_000)}+${Math.round(tc.incrementMs / 1_000)}`
    : undefined;

  const ogDescription = tcLabel
    ? t("gameDescriptionTimed", {
        boardSize: String(boardSize),
        scoreToWin: String(scoreToWin),
        timeControl: tcLabel,
      })
    : t("gameDescription", {
        boardSize: String(boardSize),
        scoreToWin: String(scoreToWin),
      });

  return {
    title,
    description: ogDescription,
    alternates: localizedAlternates(locale, pathname),
    openGraph: {
      title,
      description,
      images: OG_IMAGES,
    },
  };
}

export default function Page() {
  return <MultiplayerGamePage />;
}
