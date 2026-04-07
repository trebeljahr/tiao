import type { GameState, PlayerColor, TimeControl } from "@shared";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { Badge } from "@/components/ui/badge";
import { GamePanelBrand, AnimatedScoreTile, type AnimatedScoreTilePlayerInfo } from "./GameShared";
import { formatClockTime } from "./GameClock";
import { cn } from "@/lib/utils";

type GameSidePanelProps = {
  gameState: GameState;
  scorePulse: Record<PlayerColor, number>;
  // Clock (optional — for timed games)
  clock?: { white: number; black: number; running: boolean };
  timeControl: TimeControl;
  // Labels
  badge: string;
  badgeClassName?: string;
  statusTitle: string;
  yourTurnHighlight?: boolean;
  // Player info (multiplayer-specific)
  blackPlayerInfo?: AnimatedScoreTilePlayerInfo;
  whitePlayerInfo?: AnimatedScoreTilePlayerInfo;
  // Player labels (for computer games: "Black (AI)" etc.)
  blackLabel?: string;
  whiteLabel?: string;
  // Undo
  onUndo?: () => void;
  undoDisabled?: boolean;
  // Game state
  gameOver: boolean;
  gameOverActions?: React.ReactNode;
  // Extra content (takeback controls, forfeit, etc.)
  children?: React.ReactNode;
  // Review nav (multiplayer review mode)
  headerExtra?: React.ReactNode;
};

function formatBadgeTimeControl(tc: TimeControl): string {
  if (!tc) return "";
  const mins = Math.floor(tc.initialMs / 60_000);
  const incSec = Math.round(tc.incrementMs / 1_000);
  return incSec > 0 ? ` — ${mins}+${incSec}` : ` — ${formatClockTime(tc.initialMs)}`;
}

export function GameSidePanel({
  gameState,
  scorePulse,
  clock,
  timeControl,
  badge,
  badgeClassName,
  statusTitle,
  yourTurnHighlight,
  blackPlayerInfo,
  whitePlayerInfo,
  blackLabel = "Black",
  whiteLabel = "White",
  onUndo,
  undoDisabled,
  gameOver,
  gameOverActions,
  children,
  headerExtra,
}: GameSidePanelProps) {
  const t = useTranslations("game");
  const hasClock = timeControl !== null && clock !== undefined;

  return (
    <div className="mx-auto w-full max-w-[calc(100dvh-5rem)] space-y-4 xl:mx-0 xl:w-auto xl:min-w-[20rem] xl:max-w-md">
      <div className="mx-auto w-full xl:mx-0">
        <PaperCard
          className={cn(
            yourTurnHighlight &&
              "border-[#b7cb8d] bg-[linear-gradient(180deg,rgba(251,255,243,0.98),rgba(240,248,224,0.96))]",
          )}
        >
          <CardHeader>
            <div className="flex items-center justify-between">
              <GamePanelBrand />
              {headerExtra}
            </div>
            <Badge className={cn("w-fit bg-[#f4e8d2] text-[#6c543c]", badgeClassName)}>
              {badge}
              {timeControl ? formatBadgeTimeControl(timeControl) : ""}
            </Badge>
            <CardTitle className="text-[#2b1e14]">{statusTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 gap-4">
              <AnimatedScoreTile
                label={blackLabel}
                value={gameState.score.black}
                pulseKey={scorePulse.black}
                className="rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#39312b,#14100d)] p-5 text-[#f9f2e8] shadow-[0_18px_32px_-26px_rgba(0,0,0,0.9)]"
                labelClassName="text-xs uppercase tracking-[0.24em] text-[#d9cec2]"
                scoreToWin={gameState.scoreToWin}
                clockMs={hasClock ? clock.black : undefined}
                clockActive={hasClock && clock.running && gameState.currentTurn === "black"}
                playerInfo={blackPlayerInfo}
              />
              <AnimatedScoreTile
                label={whiteLabel}
                value={gameState.score.white}
                pulseKey={scorePulse.white}
                className="rounded-3xl border border-[#d3c3ad] bg-[linear-gradient(180deg,#fffef8,#efe4d1)] p-5 text-[#2b1e14] shadow-[0_18px_32px_-26px_rgba(84,61,36,0.45)]"
                labelClassName="text-xs uppercase tracking-[0.24em] text-[#847261]"
                scoreToWin={gameState.scoreToWin}
                clockMs={hasClock ? clock.white : undefined}
                clockActive={hasClock && clock.running && gameState.currentTurn === "white"}
                playerInfo={whitePlayerInfo}
              />
            </div>

            {onUndo && !gameOver && (
              <div className="grid gap-2">
                <Button variant="secondary" onClick={onUndo} disabled={undoDisabled}>
                  {t("undoMove")}
                </Button>
              </div>
            )}

            {children}

            {gameOver && gameOverActions && (
              <div className="grid gap-2 border-t border-[#dbc6a2] pt-4">{gameOverActions}</div>
            )}
          </CardContent>
        </PaperCard>
      </div>
    </div>
  );
}
