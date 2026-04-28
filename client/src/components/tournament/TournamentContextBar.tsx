import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function TournamentContextBar({
  tournamentId,
  tournamentName,
}: {
  tournamentId: string;
  tournamentName?: string;
}) {
  const t = useTranslations("tournament");

  return (
    <div className="fixed top-3 right-3 z-200 flex items-center gap-2 rounded-2xl border border-amber-300/50 bg-amber-50/90 px-3 py-2 text-sm shadow-[0_8px_20px_-12px_rgba(180,140,60,0.3)] backdrop-blur-sm">
      <span className="text-xs font-semibold uppercase tracking-wider text-amber-600">
        {t("tournamentLabel")}
      </span>
      {tournamentName && (
        <span className="truncate text-amber-900 max-w-[10rem]">{tournamentName}</span>
      )}
      <Link
        href={`/tournament/${tournamentId}`}
        className="text-xs font-medium text-amber-700 hover:text-amber-900 underline underline-offset-2"
      >
        {t("backToBracket")}
      </Link>
    </div>
  );
}
