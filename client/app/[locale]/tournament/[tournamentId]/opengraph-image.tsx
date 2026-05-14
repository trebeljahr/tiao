import { ImageResponse } from "next/og";
import { fetchTournament } from "@/lib/publicSeoData";
import { TIAO_OG_SIZE, TiaoOgImage } from "@/lib/tiaoOgImage";

export const alt = "Tiao tournament preview";
export const size = TIAO_OG_SIZE;
export const contentType = "image/png";

type Props = { params: Promise<{ tournamentId: string }> };

const FORMAT_LABELS: Record<string, string> = {
  "round-robin": "Round Robin",
  elimination: "Single Elimination",
  "groups-knockout": "Groups and Knockout",
};

export default async function Image({ params }: Props) {
  const { tournamentId } = await params;
  const tournament = await fetchTournament(tournamentId);
  const format = tournament
    ? (FORMAT_LABELS[tournament.settings.format] ?? tournament.settings.format)
    : "Tournament";
  const playerCount = tournament?.participants.length ?? 0;

  return new ImageResponse(
    <TiaoOgImage
      eyebrow="Tiao tournament"
      title={tournament?.name ?? "Tiao Tournament"}
      subtitle={
        tournament
          ? `${playerCount} players competing in a ${format} event. Join, follow standings, or review matches.`
          : "Join or follow a public Tiao tournament with standings, brackets, and match pages."
      }
      meta={[format, playerCount ? `${playerCount} players` : "Public event", tournamentId]}
    />,
    TIAO_OG_SIZE,
  );
}
