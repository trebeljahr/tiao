import type { TournamentGroupStanding } from "@shared";
import { useTranslations } from "next-intl";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";

export function StandingsTable({
  standings,
  highlightPlayerId,
}: {
  standings: TournamentGroupStanding[];
  highlightPlayerId?: string;
}) {
  const t = useTranslations("tournament");
  return (
    <div className="overflow-x-auto rounded-lg border border-white/50 bg-white/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 w-8">{t("standingsRank")}</th>
            <th className="px-3 py-2">{t("standingsPlayer")}</th>
            <th className="px-3 py-2 text-center w-10">{t("standingsWins")}</th>
            <th className="px-3 py-2 text-center w-10">{t("standingsLosses")}</th>
            <th className="px-3 py-2 text-center w-10">{t("standingsDraws")}</th>
            <th className="px-3 py-2 text-center w-12">{t("standingsPoints")}</th>
            <th className="px-3 py-2 text-center w-12">{t("standingsDiff")}</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s, i) => (
            <tr
              key={s.playerId}
              className={`border-b last:border-b-0 ${
                s.playerId === highlightPlayerId ? "bg-amber-50/60 font-medium" : ""
              }`}
            >
              <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
              <td className="px-3 py-2 max-w-[200px]">
                <PlayerIdentityRow
                  player={s}
                  currentPlayerId={highlightPlayerId}
                  avatarClassName="h-6 w-6"
                  nameClassName="text-sm"
                />
              </td>
              <td className="px-3 py-2 text-center">{s.wins}</td>
              <td className="px-3 py-2 text-center">{s.losses}</td>
              <td className="px-3 py-2 text-center">{s.draws}</td>
              <td className="px-3 py-2 text-center font-medium">{s.points}</td>
              <td className="px-3 py-2 text-center">
                {s.scoreDiff > 0 ? `+${s.scoreDiff}` : s.scoreDiff}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
