import { ImageResponse } from "next/og";
import { fetchGameOg } from "@/lib/publicSeoData";
import { TIAO_OG_SIZE, TiaoOgImage } from "@/lib/tiaoOgImage";

export const alt = "Tiao game preview";
export const size = TIAO_OG_SIZE;
export const contentType = "image/png";

type Props = { params: Promise<{ gameId: string }> };

export default async function Image({ params }: Props) {
  const { gameId } = await params;
  const game = await fetchGameOg(gameId);
  const id = gameId.toUpperCase();
  const white = game?.white ?? "White";
  const black = game?.black ?? "Black";
  const boardSize = game?.boardSize ?? 19;
  const scoreToWin = game?.scoreToWin ?? 10;

  const title = game ? `${white} vs ${black}` : `Tiao Game ${id}`;
  const subtitle =
    game?.status === "finished"
      ? `Final score ${game.score?.white ?? 0}-${game.score?.black ?? 0}. Review this completed Tiao match.`
      : `Watch, join, or spectate this ${boardSize}x${boardSize} Tiao game. First to ${scoreToWin} captures wins.`;

  return new ImageResponse(
    <TiaoOgImage
      eyebrow={game?.status === "active" ? "Live match" : "Game invite"}
      title={title}
      subtitle={subtitle}
      meta={[`Game ${id}`, `${boardSize}x${boardSize}`, `${scoreToWin} captures`]}
    />,
    TIAO_OG_SIZE,
  );
}
