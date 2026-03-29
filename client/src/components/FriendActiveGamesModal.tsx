import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { FriendActiveGameSummary, SocialPlayerSummary } from "@shared";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { getFriendActiveGames } from "@/lib/api";
import { toastError } from "@/lib/errors";

type FriendActiveGamesModalProps = {
  friend: SocialPlayerSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatTimeControl(
  tc: { initialMs: number; incrementMs: number } | null,
  tFriends: ReturnType<typeof useTranslations>,
): string {
  if (!tc) return tFriends("unlimited");
  const mins = Math.round(tc.initialMs / 60_000);
  const secs = Math.round(tc.incrementMs / 1_000);
  return `${mins}+${secs}`;
}

export function FriendActiveGamesModal({
  friend,
  open,
  onOpenChange,
}: FriendActiveGamesModalProps) {
  const t = useTranslations("friends");
  const tGame = useTranslations("game");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [games, setGames] = useState<FriendActiveGameSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchGames = useCallback(async () => {
    if (!friend) return;
    setLoading(true);
    try {
      const response = await getFriendActiveGames(friend.playerId);
      // Sort by createdAt descending (newest first)
      const sorted = [...response.games].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setGames(sorted);
    } catch (error) {
      toastError(error);
    } finally {
      setLoading(false);
    }
  }, [friend]);

  useEffect(() => {
    if (open && friend) {
      void fetchGames();
    }
    if (!open) {
      setGames([]);
    }
  }, [open, friend, fetchGames]);

  // Auto-refresh every 10 seconds while modal is open
  useEffect(() => {
    if (!open || !friend) return undefined;
    const interval = setInterval(() => {
      void fetchGames();
    }, 10_000);
    return () => clearInterval(interval);
  }, [open, friend, fetchGames]);

  function handleSpectate(gameId: string) {
    onOpenChange(false);
    router.push(`/game/${gameId}?spectate=true`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("activeGamesTitle")}
      description={friend ? t("activeGamesDesc", { name: friend.displayName }) : undefined}
    >
      <div className="space-y-3">
        {loading && games.length === 0 && (
          <p className="text-sm text-[#6e5b48]">{tCommon("loading")}</p>
        )}

        {!loading && games.length === 0 && (
          <p className="text-sm text-[#6e5b48]">{t("noActiveGames")}</p>
        )}

        {games.map((game) => {
          const white = game.seats.white;
          const black = game.seats.black;

          return (
            <div key={game.gameId} className="space-y-2 rounded-xl bg-white/40 p-3">
              {/* Players row */}
              <div className="flex items-center gap-2 text-sm">
                {white ? (
                  <PlayerIdentityRow
                    player={white.player}
                    online={white.online}
                    nameClassName="font-medium"
                  />
                ) : (
                  <span className="text-[#8d7760] italic">{tGame("openSeat")}</span>
                )}

                <span className="shrink-0 text-xs text-[#8d7760]">vs</span>

                {black ? (
                  <PlayerIdentityRow
                    player={black.player}
                    online={black.online}
                    nameClassName="font-medium"
                  />
                ) : (
                  <span className="text-[#8d7760] italic">{tGame("openSeat")}</span>
                )}
              </div>

              {/* Game info row */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6e5b48]">
                <span>
                  {tCommon("gameId")}: {game.gameId}
                </span>
                <span>
                  {game.boardSize}x{game.boardSize}
                </span>
                <span>
                  {game.score.white}/{game.scoreToWin} - {game.score.black}/{game.scoreToWin}
                </span>
                <span>{formatTimeControl(game.timeControl, t)}</span>
                {game.ratingBefore && (
                  <span>
                    Elo: {game.ratingBefore.white} / {game.ratingBefore.black}
                  </span>
                )}
                <span
                  className={
                    game.status === "active"
                      ? "font-medium text-green-700"
                      : "font-medium text-amber-700"
                  }
                >
                  {game.status === "active" ? t("statusActive") : t("statusWaiting")}
                </span>
              </div>

              {/* Spectate button */}
              <Button
                size="sm"
                variant="secondary"
                className="w-full text-xs"
                onClick={() => handleSpectate(game.gameId)}
              >
                {t("spectate")}
              </Button>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
