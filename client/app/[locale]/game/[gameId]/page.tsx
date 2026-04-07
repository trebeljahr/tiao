import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MultiplayerGamePage } from "@/views/MultiplayerGamePage";

type Props = { params: Promise<{ locale: string; gameId: string }> };

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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, gameId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });
  const game = await fetchGameOg(gameId);

  const id = gameId.toUpperCase();
  const fallbackTitle = t("gameTitle", { gameId: id });
  const fallbackDescription = t("siteDescription");

  if (!game) {
    return {
      title: fallbackTitle,
      description: fallbackDescription,
      openGraph: { title: fallbackTitle, description: fallbackDescription },
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
    openGraph: {
      title,
      description,
    },
  };
}

export default function Page() {
  return <MultiplayerGamePage />;
}
