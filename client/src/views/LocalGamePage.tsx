"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { TimeControl } from "@shared";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { AnimatedCard } from "@/components/ui/animated-card";
import { Dialog } from "@/components/ui/dialog";
import { Navbar } from "@/components/Navbar";
import { TiaoBoard } from "@/components/game/TiaoBoard";
import { translatePlayerColor, GamePanelBrand } from "@/components/game/GameShared";
import { GameConfigPanel } from "@/components/game/GameConfigPanel";
import { GameSidePanel } from "@/components/game/GameSidePanel";
import { useLocalGame } from "@/lib/hooks/useLocalGame";
import { useLocalClock } from "@/lib/hooks/useLocalClock";
import { useStonePlacementSound } from "@/lib/useStonePlacementSound";
import { useWinConfetti } from "@/lib/useWinConfetti";
import { useGameOverDialog } from "@/lib/hooks/useGameOverDialog";
import { isGameOver, getWinner } from "@shared";
import type { JumpTurn } from "@shared";
import { reportLocalGame } from "@/lib/api";

export function LocalGamePage() {
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("game");
  const tCommon = useTranslations("common");
  const tLobby = useTranslations("lobby");
  const [navOpen, setNavOpen] = useState(false);

  // Config state
  const [configuring, setConfiguring] = useState(true);
  const [boardSize, setBoardSize] = useState(19);
  const [scoreToWin, setScoreToWin] = useState(10);
  const [timeControl, setTimeControl] = useState<TimeControl>(null);

  const gameSettings = { boardSize, scoreToWin };
  const local = useLocalGame(gameSettings);

  // Auto-start from query params (e.g. from lobby dialog)
  const autoStartRef = useRef(false);
  useEffect(() => {
    if (autoStartRef.current) return;
    if (searchParams.has("autostart")) {
      autoStartRef.current = true;
      const bs = parseInt(searchParams.get("boardSize") || "19", 10);
      const stw = parseInt(searchParams.get("scoreToWin") || "10", 10);
      setBoardSize(bs);
      setScoreToWin(stw);
      const tcInitial = searchParams.get("tcInitial");
      const tcIncrement = searchParams.get("tcIncrement");
      if (tcInitial && tcIncrement) {
        setTimeControl({ initialMs: Number(tcInitial), incrementMs: Number(tcIncrement) });
      }
      local.resetLocalGame({ boardSize: bs, scoreToWin: stw });
      setConfiguring(false);
    }
  }, [searchParams, local.resetLocalGame]);

  const gameOver = isGameOver(local.localGame);
  const winner = gameOver ? getWinner(local.localGame) : null;
  const isDraw = gameOver && !winner;

  // Clock
  const { clock, resetClock } = useLocalClock(
    timeControl,
    local.localGame.currentTurn,
    gameOver,
    local.localGame.history,
  );

  // Timeout triggers a win for the other side
  const timeoutWinner = clock.timedOut ? (clock.timedOut === "white" ? "black" : "white") : null;
  const effectiveWinner = winner ?? timeoutWinner;
  const effectiveGameOver = gameOver || !!timeoutWinner;

  // Report local game completion for achievements (for the winner)
  const localReportedRef = useRef(false);
  const gameStartRef = useRef(Date.now());
  useEffect(() => {
    if (
      effectiveGameOver &&
      effectiveWinner &&
      auth?.player.kind === "account" &&
      !localReportedRef.current
    ) {
      localReportedRef.current = true;
      const game = local.localGame;
      const jumps = game.history.filter(
        (t): t is JumpTurn => t.type === "jump" && t.color === effectiveWinner,
      );
      const maxChain = jumps.reduce((max, j) => Math.max(max, j.jumps.length), 0);
      const opponentColor = effectiveWinner === "white" ? "black" : "white";
      void reportLocalGame({
        won: true,
        score: game.score,
        scoreToWin: game.scoreToWin,
        playerColor: effectiveWinner,
        maxChainLength: maxChain,
        opponentScoredZero: game.score[opponentColor] === 0,
        durationMs: Date.now() - gameStartRef.current,
      });
    }
  }, [effectiveGameOver, effectiveWinner, auth?.player.kind]);

  useStonePlacementSound(local.localGame);
  useWinConfetti(effectiveWinner);

  const { open: gameOverDialogOpen, setOpen: setGameOverDialogOpen } =
    useGameOverDialog(effectiveGameOver);

  const localStatusTitle = isDraw
    ? t("draw")
    : timeoutWinner
      ? t("winsOnTime", { color: translatePlayerColor(timeoutWinner, t) as string })
      : winner
        ? t("wins", { color: translatePlayerColor(winner!, t) as string })
        : t("toMove", { color: translatePlayerColor(local.localGame.currentTurn, t) as string });

  const boardWrapStyle = {
    maxWidth: "min(100%, calc(100dvh - 5rem))",
    aspectRatio: "1/1",
  };

  function handleStartGame() {
    local.resetLocalGame();
    resetClock();
    localReportedRef.current = false;
    gameStartRef.current = Date.now();
    setConfiguring(false);
  }

  function handleNewGame() {
    setConfiguring(true);
    local.resetLocalGame();
    resetClock();
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(255,247,231,0.76),transparent_58%)]" />

      <Navbar
        mode="lobby"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-416 flex-col gap-5 px-4 pb-3 pt-16 sm:px-6 sm:pt-5 lg:px-6 lg:pb-4 xl:pt-2">
        {configuring ? (
          <section className="flex items-center justify-center py-12">
            <AnimatedCard delay={0}>
              <PaperCard className="w-full max-w-md">
                <CardHeader>
                  <GamePanelBrand />
                  <CardTitle className="text-[#2b1e14]">{t("gameSetup")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <GameConfigPanel
                    mode="local"
                    boardSize={boardSize}
                    onBoardSizeChange={setBoardSize}
                    scoreToWin={scoreToWin}
                    onScoreToWinChange={setScoreToWin}
                    timeControl={timeControl}
                    onTimeControlChange={setTimeControl}
                    submitLabel={t("startGame")}
                    onSubmit={handleStartGame}
                  />
                </CardContent>
              </PaperCard>
            </AnimatedCard>
          </section>
        ) : (
          <section className="grid gap-3 xl:min-h-[calc(100dvh-1rem)] xl:content-center xl:gap-5 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
            <div className="flex items-center justify-center xl:items-start xl:justify-end">
              <div className="isolate mx-auto w-full" style={boardWrapStyle}>
                <TiaoBoard
                  state={local.localGame}
                  selectedPiece={local.localSelection}
                  jumpTargets={local.localJumpTargets}
                  confirmReady={true}
                  lastMove={local.lastMove}
                  onPointClick={effectiveGameOver ? undefined : local.handleLocalBoardClick}
                  onUndoLastJump={local.handleLocalUndoPendingJump}
                  onConfirmJump={local.handleLocalConfirmPendingJump}
                  disabled={effectiveGameOver}
                />
              </div>
            </div>

            <GameSidePanel
              gameState={local.localGame}
              scorePulse={local.localScorePulse}
              clock={timeControl ? clock : undefined}
              timeControl={timeControl}
              badge={tLobby("overTheBoard")}
              statusTitle={localStatusTitle}
              onUndo={local.handleLocalUndoTurn}
              undoDisabled={local.localGame.history.length === 0}
              gameOver={effectiveGameOver}
              gameOverActions={
                <>
                  <Button variant="secondary" onClick={handleNewGame}>
                    {t("newGame")}
                  </Button>
                  <Button variant="ghost" onClick={() => router.push("/")}>
                    {tCommon("backToLobby")}
                  </Button>
                </>
              }
            />
          </section>
        )}
      </main>

      <Dialog
        open={gameOverDialogOpen}
        onOpenChange={setGameOverDialogOpen}
        title={
          isDraw
            ? t("draw")
            : timeoutWinner
              ? t("winsOnTime", { color: translatePlayerColor(timeoutWinner, t) as string })
              : t("wins", { color: translatePlayerColor(effectiveWinner!, t) as string })
        }
        description={isDraw ? t("drawNoMoves") : t("wonDesc")}
      >
        <div className="grid gap-2">
          <Button
            onClick={() => {
              setGameOverDialogOpen(false);
              handleNewGame();
            }}
          >
            {t("newGame")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setGameOverDialogOpen(false);
              handleStartGame();
            }}
          >
            {t("rematchSameSettings")}
          </Button>
          <Button variant="ghost" onClick={() => router.push("/")}>
            {tCommon("backToLobby")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
