import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { FriendActiveGameSummary, SocialPlayerSummary, PlayerColor } from "@shared";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getFriendActiveGames } from "@/lib/api";
import { toastError } from "@/lib/errors";
import { useAuth } from "@/lib/AuthContext";
import { EmptySeatAvatar } from "@/components/game/GameShared";
import { GameConfigBadge } from "@/components/game/GameConfigBadge";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { cn } from "@/lib/utils";

type FriendActiveGamesModalProps = {
  friend: SocialPlayerSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function ColorDot({ color }: { color: PlayerColor }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 shrink-0 rounded-full border",
        color === "white"
          ? "border-[#ddd2bf] bg-[radial-gradient(circle_at_30%_28%,#fffdfa,#f4eee3_58%,#d9ccb8)]"
          : "border-[#191410] bg-[radial-gradient(circle_at_30%_28%,#5d554f,#2d2622_58%,#0f0c0b)]",
      )}
    />
  );
}

function ActiveGamePlayerRow({
  player,
  color,
  score,
  scoreToWin,
  currentPlayerId,
  online,
}: {
  player: {
    playerId?: string;
    displayName?: string;
    profilePicture?: string;
    activeBadges?: string[];
  } | null;
  color: PlayerColor;
  score: number;
  scoreToWin: number;
  currentPlayerId?: string;
  online: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-3 py-2">
      <ColorDot color={color} />
      {player ? (
        <PlayerIdentityRow
          player={player}
          currentPlayerId={currentPlayerId}
          avatarClassName="h-6 w-6"
          online={online}
          friendVariant="light"
          className="min-w-0 flex-1"
          nameClassName="text-sm font-medium text-[#2b1e14]"
        >
          <span className="font-mono text-sm tabular-nums text-[#9a8770]">
            {score}
            <span className="text-xs font-normal opacity-50">/{scoreToWin}</span>
          </span>
        </PlayerIdentityRow>
      ) : (
        <>
          <EmptySeatAvatar className="h-6 w-6" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#2b1e14]">
            Unknown
          </span>
          <span className="font-mono text-sm tabular-nums text-[#9a8770]">
            {score}
            <span className="text-xs font-normal opacity-50">/{scoreToWin}</span>
          </span>
        </>
      )}
    </div>
  );
}

export function FriendActiveGamesModal({
  friend,
  open,
  onOpenChange,
}: FriendActiveGamesModalProps) {
  const t = useTranslations("friends");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { auth } = useAuth();
  const currentPlayerId = auth?.player.playerId;
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

  function handleJoin(gameId: string) {
    onOpenChange(false);
    router.push(`/game/${gameId}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("activeGamesTitle")}
      description={friend ? t("activeGamesDesc", { name: friend.displayName }) : undefined}
      className="sm:max-w-2xl"
    >
      <div className="space-y-4">
        {loading && games.length === 0 && (
          <p className="text-sm text-[#6e5b48]">{tCommon("loading")}</p>
        )}

        {!loading && games.length === 0 && (
          <p className="text-sm text-[#6e5b48]">{t("noActiveGames")}</p>
        )}

        {games.map((game) => {
          const white = game.seats.white;
          const black = game.seats.black;
          const whitePlayer = white?.player ?? null;
          const blackPlayer = black?.player ?? null;
          const isYouPlaying =
            whitePlayer?.playerId === currentPlayerId || blackPlayer?.playerId === currentPlayerId;

          const statusBorder =
            game.status === "active" ? "border-[#a3c98a]/40" : "border-[#d7c39e]";

          return (
            <div
              key={game.gameId}
              className={cn("rounded-2xl border p-4 space-y-3 bg-white/40", statusBorder)}
            >
              {/* Header: status + game ID */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    game.status === "active"
                      ? "bg-[#c2e4a4] text-[#1a4008]"
                      : "bg-[#e8dcc6] text-[#5a4a32]",
                  )}
                >
                  {game.status === "active" ? t("statusActive") : t("statusWaiting")}
                </span>
                <span className="font-mono text-[10px] text-[#b5a48e]">{game.gameId}</span>
              </div>

              {/* Player rows */}
              <div className="space-y-1 rounded-xl border border-black/5 bg-white/50 p-1">
                <ActiveGamePlayerRow
                  player={whitePlayer}
                  color="white"
                  score={game.score.white}
                  scoreToWin={game.scoreToWin}
                  currentPlayerId={currentPlayerId}
                  online={white?.online ?? false}
                />
                <ActiveGamePlayerRow
                  player={blackPlayer}
                  color="black"
                  score={game.score.black}
                  scoreToWin={game.scoreToWin}
                  currentPlayerId={currentPlayerId}
                  online={black?.online ?? false}
                />
              </div>

              {/* Footer: config + actions */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <GameConfigBadge
                  boardSize={game.boardSize}
                  scoreToWin={game.scoreToWin}
                  timeControl={game.timeControl}
                  roomType={game.roomType}
                />
                <div className="flex items-center gap-2">
                  {isYouPlaying ? (
                    <Button size="sm" className="text-xs" onClick={() => handleJoin(game.gameId)}>
                      {t("joinGame")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => handleSpectate(game.gameId)}
                    >
                      {t("spectate")}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
