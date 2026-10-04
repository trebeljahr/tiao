import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DESKTOP_SPA_PARAM_VALUE } from "@/lib/desktopPathParam";
import { localizedAlternates, localizedOpenGraphImage } from "@/lib/metadata";
import { fetchTournament } from "@/lib/publicSeoData";
import { TournamentPage } from "@/views/TournamentPage";

type Props = { params: Promise<{ locale: string; tournamentId: string }> };

// See the matching constant in /app/[locale]/game/[gameId]/page.tsx —
// controls the web/desktop split for the shareable dynamic routes.
// Desktop (Electron) and mobile (Capacitor) both ship a static export.
const IS_STATIC_EXPORT =
  process.env.NEXT_PUBLIC_PLATFORM === "desktop" || process.env.NEXT_PUBLIC_PLATFORM === "mobile";

const FORMAT_LABELS: Record<string, string> = {
  "round-robin": "Round Robin",
  elimination: "Single Elimination",
  "groups-knockout": "Groups + Knockout",
};

/** See the twin function in /app/[locale]/game/[gameId]/page.tsx. */
export function generateStaticParams() {
  if (IS_STATIC_EXPORT) return [{ tournamentId: DESKTOP_SPA_PARAM_VALUE }];
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, tournamentId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });
  const pathname = `/tournament/${encodeURIComponent(tournamentId)}`;
  const routeImages = [localizedOpenGraphImage(locale, pathname, "Tiao tournament preview")];

  // Desktop static export: static fallback metadata only. See the
  // matching /game/[gameId]/page.tsx branch for the reasoning.
  if (IS_STATIC_EXPORT) {
    const title = t("tournamentsTitle");
    const description = t("tournamentsDescription");
    return {
      title,
      description,
      alternates: localizedAlternates(locale, pathname),
      openGraph: { title, description, images: routeImages },
      twitter: { card: "summary_large_image", title, description, images: [routeImages[0].url] },
    };
  }

  const tournament = await fetchTournament(tournamentId);

  if (!tournament) {
    const fallback = t("tournamentsTitle");
    return {
      title: fallback,
      description: t("tournamentsDescription"),
      alternates: localizedAlternates(locale, pathname),
      openGraph: { title: fallback, description: t("tournamentsDescription"), images: routeImages },
      twitter: {
        card: "summary_large_image",
        title: fallback,
        description: t("tournamentsDescription"),
        images: [routeImages[0].url],
      },
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
    alternates: localizedAlternates(locale, pathname),
    openGraph: { title, description, images: routeImages },
    twitter: { card: "summary_large_image", title, description, images: [routeImages[0].url] },
  };
}

export default function Page() {
  return <TournamentPage />;
}
