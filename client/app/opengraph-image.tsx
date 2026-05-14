import { ImageResponse } from "next/og";
import { TIAO_OG_SIZE, TiaoOgImage } from "@/lib/tiaoOgImage";

export const alt = "Tiao online strategy board game";
export const size = TIAO_OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <TiaoOgImage
      eyebrow="Free online board game"
      title="Tiao"
      subtitle="Play a beautiful abstract strategy game with friends, AI opponents, tournaments, and ranked matchmaking."
      meta={["Multiplayer", "AI practice", "Tournaments"]}
    />,
    TIAO_OG_SIZE,
  );
}
