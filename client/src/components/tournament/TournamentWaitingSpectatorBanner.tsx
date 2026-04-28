"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useTournamentNextMatch } from "@/lib/hooks/useTournamentNextMatch";

/**
 * Thin banner shown above the board when a tournament player has been
 * routed into an in-progress match as a spectator while they wait for
 * their own next pairing. Polls the server's next-match decision via
 * `useTournamentNextMatch` and auto-navigates the player into their
 * match the instant it becomes ready. If the server reports their
 * tournament is over ("done"), the banner triggers a redirect back to
 * the bracket so the player sees the results view.
 */
export function TournamentWaitingSpectatorBanner({
  tournamentId,
  onReady,
}: {
  tournamentId: string;
  onReady: (roomId: string) => void;
}) {
  const t = useTranslations("tournament");
  const { result } = useTournamentNextMatch(tournamentId);

  useEffect(() => {
    if (!result) return;
    if (result.state === "ready") {
      onReady(result.roomId);
    }
  }, [result, onReady]);

  return (
    <div className="border-b border-amber-200/60 bg-amber-50/80 px-4 py-2 text-sm">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-amber-700">
          {t("waitingBannerLabel")}
        </span>
        <span className="truncate text-amber-900">{t("waitingBannerDesc")}</span>
      </div>
    </div>
  );
}
