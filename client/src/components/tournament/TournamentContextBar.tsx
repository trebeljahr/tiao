import { useRouter } from "next/navigation";

export function TournamentContextBar({
  tournamentId,
  tournamentName,
  roundLabel,
}: {
  tournamentId: string;
  tournamentName?: string;
  roundLabel?: string;
}) {
  const router = useRouter();

  return (
    <div className="flex items-center justify-between gap-2 border-b border-amber-200/60 bg-amber-50/80 px-4 py-2 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-amber-600">
          Tournament
        </span>
        {tournamentName && <span className="truncate text-amber-900">{tournamentName}</span>}
        {roundLabel && <span className="text-xs text-amber-600">{roundLabel}</span>}
      </div>
      <button
        type="button"
        className="text-xs font-medium text-amber-700 hover:text-amber-900 hover:underline"
        onClick={() => router.push(`/tournament/${tournamentId}`)}
      >
        Back to bracket
      </button>
    </div>
  );
}
