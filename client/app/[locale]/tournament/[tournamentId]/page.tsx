import { DESKTOP_SPA_PARAM_VALUE } from "@/lib/desktopPathParam";
import { OG_IMAGES } from "@/lib/metadata";
import { TournamentPage } from "@/views/TournamentPage";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

type Props = { params: Promise<{ locale: string; tournamentId: string }> };

// See the matching constant in /app/[locale]/game/[gameId]/page.tsx —
// controls the web/desktop split for the shareable dynamic routes.
const IS_DESKTOP_BUILD = process.env.NEXT_PUBLIC_PLATFORM === "desktop";

async function fetchTournament(tournamentId: string) {
  if (process.env.NODE_ENV === "development") return null;
  const apiBase = process.env.API_URL || `http://127.0.0.1:${process.env.API_PORT || "5005"}`;
  try {
    const res = await fetch(`${apiBase}/api/tournaments/${encodeURIComponent(tournamentId)}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tournament: {
        name: string;
        settings: { format: string };
        participants: unknown[];
      };
    };
    return data.tournament;
  } catch {
    return null;
  }
}

const FORMAT_LABELS: Record<string, string> = {
  "round-robin": "Round Robin",
  elimination: "Single Elimination",
  "groups-knockout": "Groups + Knockout",
};

/** See the twin function in /app/[locale]/game/[gameId]/page.tsx. */
export function generateStaticParams() {
  if (IS_DESKTOP_BUILD) return [{ tournamentId: DESKTOP_SPA_PARAM_VALUE }];
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, tournamentId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });

  // Desktop static export: static fallback metadata only. See the
  // matching /game/[gameId]/page.tsx branch for the reasoning.
  if (IS_DESKTOP_BUILD) {
    const title = t("tournamentsTitle");
    const description = t("tournamentsDescription");
    return {
      title,
      description,
      openGraph: { title, description, images: OG_IMAGES },
    };
  }

  const tournament = await fetchTournament(tournamentId);

  if (!tournament) {
    const fallback = t("tournamentsTitle");
    return {
      title: fallback,
      description: t("tournamentsDescription"),
      openGraph: { title: fallback, description: t("tournamentsDescription"), images: OG_IMAGES },
    };
  }

  const title = t("tournamentDetail", { name: tournament.name });
  const format = FORMAT_LABELS[tournament.settings.format] ?? tournament.settings.format;
  const description = t("tournamentDetailDescription", {
    playerCount: String(tournament.participants.length),
    format,
  });

  return {
    title,
    description,
    openGraph: { title, description, images: OG_IMAGES },
  };
}

export default function Page() {
  return <TournamentPage />;
}
