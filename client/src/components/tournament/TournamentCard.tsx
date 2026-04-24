import { GameConfigBadge } from "@/components/game/GameConfigBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TournamentListItem } from "@shared";
import { useTranslations } from "next-intl";

function statusColor(status: string): string {
  switch (status) {
    case "registration":
      return "border-green-400 bg-green-50 text-green-700";
    case "active":
      return "border-blue-400 bg-blue-50 text-blue-700";
    case "finished":
      return "border-slate-300 bg-slate-50 text-slate-600";
    case "cancelled":
      return "border-red-300 bg-red-50 text-red-600";
    default:
      return "";
  }
}

export function TournamentCard({
  item,
  onClick,
  showFeatured,
  extra,
}: {
  item: TournamentListItem;
  onClick: () => void;
  showFeatured?: boolean;
  extra?: React.ReactNode;
}) {
  const t = useTranslations("tournament");
  const tCommon = useTranslations("common");

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: event interceptor on container, not interactive (keyboard handled separately)
    <div
      className="flex items-center justify-between rounded-2xl border border-[#dcc7a2] bg-[#fffdf7] p-4 shadow-xs hover:border-[#b98d49] transition-colors cursor-pointer group"
      onClick={onClick}
    >
      <div className="flex flex-col min-w-0 gap-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-[#2b1e14] truncate">{item.name}</span>
          {showFeatured && item.isFeatured && (
            <Badge className="shrink-0 border-amber-400 bg-amber-50 text-amber-700">
              {t("featured")}
            </Badge>
          )}
          <Badge className={cn("shrink-0", statusColor(item.status))}>{t(item.status)}</Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <span>{t("players", { count: item.playerCount, max: item.maxPlayers })}</span>
          <span className="opacity-40">·</span>
          <span>{t("by", { name: item.creatorDisplayName })}</span>
          <GameConfigBadge
            boardSize={item.boardSize}
            scoreToWin={item.scoreToWin}
            timeControl={item.timeControl}
            compact
          />
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {extra}
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          {tCommon("view")}
        </Button>
      </div>
    </div>
  );
}
