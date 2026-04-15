"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PlayerColor } from "@shared";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Navbar } from "@/components/Navbar";
import { TiaoBoard } from "@/components/game/TiaoBoard";
import { translatePlayerColor, HourglassSpinner } from "@/components/game/GameShared";
import { GameSidePanel } from "@/components/game/GameSidePanel";
import { GameConfigDialog } from "@/components/game/GameConfigDialog";
import { useGameConfig } from "@/lib/hooks/useGameConfig";
import { useComputerGame } from "@/lib/hooks/useComputerGame";
import { useStonePlacementSound } from "@/lib/useStonePlacementSound";
import { useWinConfetti } from "@/lib/useWinConfetti";
import { useGameOverDialog } from "@/lib/hooks/useGameOverDialog";
import { isGameOver, getWinner } from "@shared";
import type { AIDifficulty } from "@/lib/computer-ai";
import { reportAIWin } from "@/lib/api";

export function ComputerGamePage() {
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const t = useTranslations("game");
  const tCommon = useTranslations("common");
  const tConfig = useTranslations("config");
  const searchParams = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);

  // Parse autostart params synchronously on first render so the config
  // hook, board state, and dialog open state all start correct — otherwise
  // the default setup briefly flashes before the autostart effect runs.
  const autostartConfig = React.useRef<{
    boardSize: number;
    scoreToWin: number;
    color: PlayerColor | "random";
    difficulty: AIDifficulty;
  } | null>(null);
  if (autostartConfig.current === null && searchParams.has("autostart")) {
    const d = Number(searchParams.get("difficulty") || 1) as AIDifficulty;
    const c = (searchParams.get("color") || "white") as PlayerColor;
    autostartConfig.current = {
      boardSize: parseInt(searchParams.get("boardSize") || "19", 10),
      scoreToWin: parseInt(searchParams.get("scoreToWin") || "10", 10),
      color: c,
      difficulty: d,
    };
  }

  // Unified game setup: the dialog drives every configuration change.
  // `difficultyCommitted` is only set once the player commits via submit —
  // before that the computer game hook runs with a placeholder but its
  // controls are disabled because the dialog blocks the board. On autostart
  // the commit happens synchronously from URL params so we skip the dialog
  // and the AI is live on first render.
  const config = useGameConfig("computer", autostartConfig.current ?? undefined);
  const [setupOpen, setSetupOpen] = useState(() => autostartConfig.current === null);
  const [difficultyCommitted, setDifficultyCommitted] = useState<AIDifficulty | null>(
    () => autostartConfig.current?.difficulty ?? null,
  );

  const gameSettings = { boardSize: config.boardSize, scoreToWin: config.scoreToWin };
  // Seed the computer hook's initial colour from autostart so the human/bot
  // seat assignment is correct on first render (without this, we'd briefly
  // render a random colour and then flip on the effect).
  const initialComputerColor: PlayerColor | undefined = autostartConfig.current
    ? autostartConfig.current.color === "white"
      ? "black"
      : "white"
    : undefined;
  const computer = useComputerGame(difficultyCommitted ?? 3, gameSettings, initialComputerColor);

  const handleStartGame = useCallback(() => {
    const playerColorChoice = config.color === "random" ? undefined : config.color;
    const computerCol = playerColorChoice
      ? playerColorChoice === "white"
        ? "black"
        : "white"
      : undefined;
    setDifficultyCommitted(config.difficulty);
    computer.resetLocalGame(computerCol, {
      boardSize: config.boardSize,
      scoreToWin: config.scoreToWin,
    });
    setSetupOpen(false);
  }, [config.difficulty, config.color, config.boardSize, config.scoreToWin, computer]);

  const handleChangeDifficulty = useCallback(() => {
    setSetupOpen(true);
  }, []);

  useStonePlacementSound(computer.localGame);
  const gameOver = isGameOver(computer.localGame);
  const winner = gameOver ? getWinner(computer.localGame) : null;
  const isDraw = gameOver && !winner;
  const playerColor = computer.computerColor === "white" ? "black" : "white";
  useWinConfetti(winner, { viewerColor: playerColor });

  const { open: gameOverDialogOpen, setOpen: setGameOverDialogOpen } = useGameOverDialog(gameOver);

  // E2E test hook: when ?e2e=1 is in the URL, expose a small test helper on
  // window so Playwright can force a win deterministically without touching
  // React internals. Gated on the query param so it never ships to users.
  const setLocalGame = computer.setLocalGame;
  useEffect(() => {
    if (!searchParams.has("e2e")) return;
    const w = window as unknown as {
      __tiaoComputerTest__?: { forceWin: (color?: "white" | "black") => void };
    };
    w.__tiaoComputerTest__ = {
      forceWin: (color = "white") => {
        setLocalGame((prev) => ({
          ...prev,
          score: { ...prev.score, [color]: prev.scoreToWin ?? 10 },
        }));
      },
    };
    return () => {
      delete w.__tiaoComputerTest__;
    };
  }, [searchParams, setLocalGame]);

  const playerWon = winner !== null && winner !== computer.computerColor;

  // Report AI win for achievements
  const reportedRef = React.useRef(false);
  useEffect(() => {
    if (
      playerWon &&
      difficultyCommitted &&
      auth?.player.kind === "account" &&
      !reportedRef.current
    ) {
      reportedRef.current = true;
      void reportAIWin(difficultyCommitted);
    }
  }, [playerWon, difficultyCommitted, auth?.player.kind]);

  const gameOverTitle = isDraw ? t("draw") : playerWon ? t("youWon") : t("youLost");
  const gameOverDescription = isDraw ? t("drawNoMoves") : playerWon ? t("wonDesc") : t("lostDesc");

  const localStatusTitle = isDraw
    ? t("draw")
    : winner
      ? t("wins", { color: translatePlayerColor(winner!, t) as string })
      : computer.computerThinking
        ? t("computerThinking")
        : t("toMove", { color: translatePlayerColor(computer.localGame.currentTurn, t) as string });

  const boardWrapStyle = {
    maxWidth: "min(100%, calc(100dvh - 5rem))",
    aspectRatio: "1/1",
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(255,247,231,0.76),transparent_58%)]" />

      <Navbar
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-416 flex-col gap-5 px-4 pb-3 pt-16 sm:px-6 sm:pt-5 lg:px-6 lg:pb-4 xl:pt-2">
        <section className="grid gap-3 xl:min-h-[calc(100dvh-1rem)] xl:content-center xl:gap-5 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
          <div className="flex items-center justify-center xl:items-start xl:justify-end">
            <div className="relative isolate mx-auto w-full" style={boardWrapStyle}>
              <TiaoBoard
                state={computer.localGame}
                selectedPiece={computer.localSelection}
                jumpTargets={computer.localJumpTargets}
                confirmReady={true}
                lastMove={computer.lastMove}
                onPointClick={computer.handleLocalBoardClick}
                onUndoLastJump={computer.handleLocalUndoPendingJump}
                onConfirmJump={computer.handleLocalConfirmPendingJump}
                disabled={computer.controlsDisabled}
              />
              {computer.computerThinking && (
                <div className="pointer-events-none absolute inset-0 z-200 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center gap-3 rounded-3xl border border-[#dcc7a2] bg-[#fff7ec]/95 px-5 py-3 text-sm font-semibold text-[#5d4732] shadow-lg backdrop-blur-sm">
                      <HourglassSpinner className="text-[#7b5f3f]" />
                      {t("aiThinking")}
                    </div>
                    {computer.thinkProgress > 0 && (
                      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-[#e8d9c0]">
                        <div
                          className="h-full rounded-full bg-[#7b5f3f] transition-[width] duration-150 ease-linear"
                          style={{
                            width: `${Math.round(computer.thinkProgress * 100)}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <GameSidePanel
            gameState={computer.localGame}
            scorePulse={computer.localScorePulse}
            timeControl={null}
            badge={t("vsAi", {
              difficulty: tConfig(
                difficultyCommitted === 1
                  ? "easy"
                  : difficultyCommitted === 2
                    ? "intermediate"
                    : "hard",
              ),
            })}
            badgeClassName="bg-[#edf5e4] text-[#486334]"
            statusTitle={localStatusTitle}
            blackLabel={computer.computerColor === "black" ? t("blackAi") : t("blackYou")}
            whiteLabel={computer.computerColor === "white" ? t("whiteAi") : t("whiteYou")}
            onUndo={computer.handleLocalUndoTurn}
            undoDisabled={!computer.canUndo}
            gameOver={gameOver}
            gameOverActions={
              <>
                <Button variant="secondary" onClick={() => computer.resetLocalGame()}>
                  {t("restartBoard")}
                </Button>
                <Button variant="secondary" onClick={handleChangeDifficulty}>
                  {t("changeDifficulty")}
                </Button>
                <Button variant="ghost" onClick={() => router.push("/")}>
                  {tCommon("backToLobby")}
                </Button>
              </>
            }
          />
        </section>
      </main>

      <GameConfigDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        title={t("gameSetup")}
        config={config}
        submitLabel={t("startGame")}
        onSubmit={handleStartGame}
        closeable={false}
      />

      <Dialog
        open={gameOverDialogOpen}
        onOpenChange={setGameOverDialogOpen}
        title={gameOverTitle}
        description={gameOverDescription}
      >
        <div className="grid gap-2">
          <Button
            onClick={() => {
              setGameOverDialogOpen(false);
              computer.resetLocalGame();
            }}
          >
            {playerWon ? t("playAgain") : t("tryAgain")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setGameOverDialogOpen(false);
              handleChangeDifficulty();
            }}
          >
            {t("changeDifficulty")}
          </Button>
          <Button variant="ghost" onClick={() => router.push("/")}>
            {tCommon("backToLobby")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
