"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { MultiplayerGameSummary } from "@shared";
import { ActiveGameCard } from "@/components/game/ActiveGameCard";
import { isSummaryYourTurn } from "@/components/game/GameShared";
import { cancelMultiplayerGame, cancelRematchRequest } from "@/lib/api";
import { toastError } from "@/lib/errors";
import { cn } from "@/lib/utils";

type ActiveGamesListProps = {
  games: MultiplayerGameSummary[];
  finishedGamesWithRematch?: MultiplayerGameSummary[];
  refreshGames: (opts?: { silent?: boolean }) => Promise<void>;
  limit?: number;
  gridClassName?: string;
  emptyClassName?: string;
  "data-testid-prefix"?: string;
};

export function ActiveGamesList({
  games,
  finishedGamesWithRematch = [],
  refreshGames,
  limit,
  gridClassName,
  emptyClassName,
  "data-testid-prefix": testIdPrefix,
}: ActiveGamesListProps) {
  const t = useTranslations("games");
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cancellingRematchId, setCancellingRematchId] = useState<string | null>(null);

  const sortedGames = useMemo(() => {
    const combined = [...games, ...finishedGamesWithRematch];
    return combined.sort((a, b) => {
      const aRematch = a.status === "finished" && !!a.rematch?.requestedBy.length;
      const bRematch = b.status === "finished" && !!b.rematch?.requestedBy.length;
      if (aRematch && !bRematch) return -1;
      if (!aRematch && bRematch) return 1;
      const aYourTurn = isSummaryYourTurn(a);
      const bYourTurn = isSummaryYourTurn(b);
      if (aYourTurn && !bYourTurn) return -1;
      if (!aYourTurn && bYourTurn) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [games, finishedGamesWithRematch]);

  const displayGames = limit ? sortedGames.slice(0, limit) : sortedGames;

  const handleDelete = useCallback(
    async (gameId: string) => {
      setDeletingId(gameId);
      try {
        await cancelMultiplayerGame(gameId);
        void refreshGames({ silent: true });
      } catch (err) {
        toastError(err);
      } finally {
        setDeletingId(null);
      }
    },
    [refreshGames],
  );

  const handleCancelRematch = useCallback(
    async (gameId: string) => {
      setCancellingRematchId(gameId);
      try {
        await cancelRematchRequest(gameId);
        void refreshGames({ silent: true });
      } catch (err) {
        toastError(err);
      } finally {
        setCancellingRematchId(null);
      }
    },
    [refreshGames],
  );

  return (
    <div className={cn("grid gap-3", gridClassName)}>
      {displayGames.map((game) => (
        <ActiveGameCard
          key={game.gameId}
          game={game}
          data-testid={testIdPrefix ? `${testIdPrefix}${game.gameId}` : undefined}
          onResume={() => router.push(`/game/${game.gameId}`)}
          onDelete={() => handleDelete(game.gameId)}
          deleting={deletingId === game.gameId}
          onCancelRematch={() => handleCancelRematch(game.gameId)}
          cancellingRematch={cancellingRematchId === game.gameId}
        />
      ))}
      {displayGames.length === 0 && (
        <p className={cn("col-span-full py-8 text-center text-sm text-[#6e5b48]", emptyClassName)}>
          {t("noActiveGames")}
        </p>
      )}
    </div>
  );
}
