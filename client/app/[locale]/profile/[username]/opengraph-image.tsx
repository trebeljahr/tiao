import { ImageResponse } from "next/og";
import { fetchPublicProfile } from "@/lib/publicSeoData";
import { TIAO_OG_SIZE, TiaoOgImage } from "@/lib/tiaoOgImage";

export const alt = "Tiao public profile preview";
export const size = TIAO_OG_SIZE;
export const contentType = "image/png";

type Props = { params: Promise<{ username: string }> };

export default async function Image({ params }: Props) {
  const { username } = await params;
  const profile = await fetchPublicProfile(username);
  const name = profile?.displayName ?? username;
  const gamesPlayed = profile?.gamesPlayed ?? 0;
  const wins = profile?.gamesWon ?? 0;
  const rating = profile?.rating;

  return new ImageResponse(
    <TiaoOgImage
      eyebrow="Tiao player profile"
      title={`${name} on Tiao`}
      subtitle="Public profile with rating, match history, badges, and recent games."
      meta={[
        rating ? `${rating} rating` : "Public profile",
        gamesPlayed ? `${gamesPlayed} games` : "Match history",
        wins ? `${wins} wins` : "Badges",
      ]}
    />,
    TIAO_OG_SIZE,
  );
}
