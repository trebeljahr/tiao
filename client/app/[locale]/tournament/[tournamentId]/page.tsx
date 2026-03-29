import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TournamentPage } from "@/views/TournamentPage";

type Props = { params: Promise<{ locale: string; tournamentId: string }> };

async function fetchTournament(tournamentId: string) {
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, tournamentId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "og" });
  const tournament = await fetchTournament(tournamentId);

  if (!tournament) {
    const fallback = t("tournamentsTitle");
    return {
      title: fallback,
      description: t("tournamentsDescription"),
      openGraph: { title: fallback, description: t("tournamentsDescription") },
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
    openGraph: { title, description },
  };
}

export default function Page() {
  return <TournamentPage />;
}
