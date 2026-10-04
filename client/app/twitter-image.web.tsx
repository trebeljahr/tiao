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
      subtitle="Play online with friends, practice against AI, and join tournaments on a Go-inspired board."
      meta={["1200 x 630", "Strategy", "Play online"]}
    />,
    TIAO_OG_SIZE,
  );
}
