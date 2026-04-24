import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { formatFinishReason } from "@/components/game/GameShared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TournamentMatch } from "@shared";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

function statusColor(status: TournamentMatch["status"]): string {
  switch (status) {
    case "active":
      return "border-green-400 bg-green-50 text-green-700";
    case "finished":
    case "forfeit":
      return "border-slate-300 bg-slate-50 text-slate-600";
    case "bye":
      return "border-amber-300 bg-amber-50 text-amber-700";
    default:
      return "";
  }
}

export function MatchCard({
  match,
  currentPlayerId,
  featured,
  roundLabel,
}: {
  match: TournamentMatch;
  currentPlayerId?: string;
  featured?: boolean;
  /** When provided, shown as a small label above the match (e.g., "Quarterfinals", "Round 1"). */
  roundLabel?: string;
}) {
  const router = useRouter();
  const t = useTranslations("tournament");
  const tCommon = useTranslations("common");
  const tGame = useTranslations("game");

  function statusLabel(status: TournamentMatch["status"]): string {
    switch (status) {
      case "pending":
        return t("upcoming");
      case "active":
        return t("live");
      case "finished":
        return t("finished");
      case "forfeit":
        return tGame("forfeit");
      case "bye":
        return t("bye");
    }
  }

  const isMyMatch = currentPlayerId && match.players.some((p) => p?.playerId === currentPlayerId);
  const isDone = match.status === "finished" || match.status === "forfeit";
  const reason = isDone ? formatFinishReason(match.finishReason ?? null, undefined, tGame) : "";

  return (
    <div
      className={`overflow-hidden rounded-xl border p-3 ${
        featured ? "border-amber-400/60 bg-amber-50/40" : "border-white/50 bg-white/60"
      }`}
    >
      {/* Top row: optional round label on the left, status/finish info on the right */}
      <div className="mb-1 flex min-h-6 items-center justify-between gap-2">
        {roundLabel ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a07c4d]">
            {roundLabel}
          </span>
        ) : (
          <span />
        )}
        {!isDone && (
          <Badge className={statusColor(match.status)}>{statusLabel(match.status)}</Badge>
        )}
        {isDone && (
          <div className="flex items-center gap-2">
            {reason && <span className="text-[11px] text-muted-foreground">{reason}</span>}
            {match.historyLength != null && (
              <span className="text-[11px] text-muted-foreground">
                {tCommon("moves", { count: match.historyLength })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Player rows */}
      <div className="min-w-0 space-y-1">
        {match.players.map((player, i) => (
          <div
            key={i}
            className={`flex min-w-0 items-center gap-2 text-sm ${
              match.winner && player?.playerId === match.winner
                ? "font-semibold"
                : match.winner
                  ? "text-muted-foreground"
                  : ""
            }`}
          >
            <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">
              #{player?.seed ?? "?"}
            </span>
            {match.playerColors?.[i] && (
              <span
                className={`h-3 w-3 shrink-0 rounded-full border ${
                  match.playerColors[i] === "white"
                    ? "border-slate-300 bg-white"
                    : "border-slate-400 bg-slate-800"
                }`}
                title={match.playerColors[i] === "white" ? tGame("white") : tGame("black")}
              />
            )}
            {player ? (
              <PlayerIdentityRow
                player={player}
                currentPlayerId={currentPlayerId}
                avatarClassName="h-6 w-6"
                nameClassName="text-sm"
                className="min-w-0 flex-1 flex-wrap"
              />
            ) : (
              <span className="truncate text-muted-foreground">{t("tbd")}</span>
            )}
            {isDone && player?.playerId === match.winner && (
              <span className="shrink-0 inline-flex items-center rounded-full border border-green-400 bg-green-50 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider text-green-700">
                {tGame("won")}
              </span>
            )}
            {match.status !== "pending" && match.status !== "bye" && (
              <span className="shrink-0 text-xs text-muted-foreground">{match.score[i]}</span>
            )}
          </div>
        ))}
      </div>

      {/* Bottom row: action buttons aligned right */}
      {match.roomId && (match.status === "active" || isDone) && (
        <div className="mt-2 flex items-center justify-end">
          {match.status === "active" && (
            <Button
              size="sm"
              variant={isMyMatch ? "default" : "outline"}
              onClick={() => router.push(`/game/${match.roomId}`)}
            >
              {isMyMatch ? tCommon("play") : tCommon("watch")}
            </Button>
          )}
          {isDone && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push(`/game/${match.roomId}`)}
            >
              {tCommon("review")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
