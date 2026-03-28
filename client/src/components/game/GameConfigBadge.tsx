import type { TimeControl, MultiplayerRoomType } from "@shared";
import { useTranslations } from "next-intl";

type GameConfigBadgeProps = {
  boardSize?: number;
  scoreToWin?: number;
  timeControl?: TimeControl;
  roomType?: MultiplayerRoomType;
  compact?: boolean;
};

export function GameConfigBadge({
  boardSize,
  scoreToWin,
  timeControl,
  roomType,
  compact,
}: GameConfigBadgeProps) {
  const tGame = useTranslations("game");
  const tTournament = useTranslations("tournament");
  const tLobby = useTranslations("lobby");

  const parts: string[] = [];

  if (roomType) {
    switch (roomType) {
      case "tournament":
        parts.push(tTournament("title"));
        break;
      case "matchmaking":
        parts.push(tLobby("matchmaking"));
        break;
    }
  }

  if (boardSize && boardSize !== 19) {
    parts.push(`${boardSize}x${boardSize}`);
  }

  if (scoreToWin && scoreToWin !== 10) {
    parts.push(compact ? tGame("nPts", { n: scoreToWin }) : tGame("nToWin", { n: scoreToWin }));
  }

  if (timeControl) {
    const mins = Math.floor(timeControl.initialMs / 60_000);
    const incSec = Math.round(timeControl.incrementMs / 1_000);
    const tcLabel = incSec > 0 ? `${mins}+${incSec}` : tGame("nMin", { n: mins });
    parts.push(tcLabel);
  }

  if (parts.length === 0) return null;

  return <span className="text-xs text-[#8d7760]">{parts.join(" · ")}</span>;
}
