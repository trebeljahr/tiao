"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PlayerColor } from "@shared";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { Dialog } from "@/components/ui/dialog";
import { Navbar } from "@/components/Navbar";
import { TiaoBoard } from "@/components/game/TiaoBoard";
import {
  GamePanelBrand,
  translatePlayerColor,
  HourglassSpinner,
} from "@/components/game/GameShared";
import { GameSidePanel } from "@/components/game/GameSidePanel";
import { GameConfigPanel } from "@/components/game/GameConfigPanel";
import { useComputerGame } from "@/lib/hooks/useComputerGame";
import { useStonePlacementSound } from "@/lib/useStonePlacementSound";
import { useWinConfetti } from "@/lib/useWinConfetti";
import { useGameOverDialog } from "@/lib/hooks/useGameOverDialog";
import { isGameOver, getWinner } from "@shared";
import type { AIDifficulty } from "@/lib/computer-ai";

export function ComputerGamePage() {
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const t = useTranslations("game");
  const tCommon = useTranslations("common");
  const tConfig = useTranslations("config");
  const searchParams = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);
  const [difficulty, setDifficulty] = useState<AIDifficulty | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<AIDifficulty>(2);
  const [selectedColor, setSelectedColor] = useState<PlayerColor | "random">("random");
  const [boardSize, setBoardSize] = useState(19);
  const [scoreToWin, setScoreToWin] = useState(10);
  const gameSettings = { boardSize, scoreToWin };
  const computer = useComputerGame(difficulty ?? 3, gameSettings);

  const handleStartGame = useCallback(() => {
    setDifficulty(selectedDifficulty);
    const playerColorChoice = selectedColor === "random" ? undefined : selectedColor;
    const computerCol = playerColorChoice
      ? playerColorChoice === "white"
        ? "black"
        : "white"
      : undefined;
    computer.resetLocalGame(computerCol);
  }, [selectedDifficulty, selectedColor, computer.resetLocalGame]);

  // Auto-start from query params (e.g. from tutorial)
  const autoStartRef = React.useRef(false);
  useEffect(() => {
    if (autoStartRef.current) return;
    if (searchParams.has("autostart")) {
      autoStartRef.current = true;
      const d = Number(searchParams.get("difficulty") || 1) as AIDifficulty;
      const c = (searchParams.get("color") || "white") as PlayerColor;
      const bs = parseInt(searchParams.get("boardSize") || "19", 10);
      const stw = parseInt(searchParams.get("scoreToWin") || "10", 10);
      setSelectedDifficulty(d);
      setSelectedColor(c);
      setBoardSize(bs);
      setScoreToWin(stw);
      setDifficulty(d);
      computer.resetLocalGame(c === "white" ? "black" : "white");
    }
  }, [searchParams, computer.resetLocalGame]);

  const handleChangeDifficulty = useCallback(() => {
    setDifficulty(null);
    computer.resetLocalGame();
  }, [computer.resetLocalGame]);

  useStonePlacementSound(computer.localGame);
  const gameOver = isGameOver(computer.localGame);
  const winner = gameOver ? getWinner(computer.localGame) : null;
  const isDraw = gameOver && !winner;
  const playerColor = computer.computerColor === "white" ? "black" : "white";
  useWinConfetti(winner, { viewerColor: playerColor });

  const { open: gameOverDialogOpen, setOpen: setGameOverDialogOpen } = useGameOverDialog(gameOver);

  const playerWon = winner !== null && winner !== computer.computerColor;
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
        mode="lobby"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-416 flex-col gap-5 px-4 pb-3 pt-16 sm:px-6 sm:pt-5 lg:px-6 lg:pb-4 xl:pt-2">
        {difficulty === null ? (
          <section className="flex items-center justify-center py-12">
            <PaperCard className="w-full max-w-md">
              <CardHeader>
                <GamePanelBrand />
                <CardTitle className="text-[#2b1e14]">{t("gameSetup")}</CardTitle>
              </CardHeader>
              <CardContent>
                <GameConfigPanel
                  mode="computer"
                  boardSize={boardSize}
                  onBoardSizeChange={setBoardSize}
                  scoreToWin={scoreToWin}
                  onScoreToWinChange={setScoreToWin}
                  timeControl={null}
                  onTimeControlChange={() => {}}
                  difficulty={selectedDifficulty}
                  onDifficultyChange={setSelectedDifficulty}
                  selectedColor={selectedColor}
                  onColorChange={setSelectedColor}
                  submitLabel={t("startGame")}
                  onSubmit={handleStartGame}
                />
              </CardContent>
            </PaperCard>
          </section>
        ) : (
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
                  difficulty === 1 ? "easy" : difficulty === 2 ? "intermediate" : "hard",
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
        )}
      </main>

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
