import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthResponse } from "@shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/Navbar";
import { TiaoBoard } from "@/components/game/TiaoBoard";
import {
  GamePanelBrand,
  AnimatedScoreTile,
  formatPlayerColor,
  HourglassSpinner,
} from "@/components/game/GameShared";
import { useComputerGame } from "@/lib/hooks/useComputerGame";
import { useStonePlacementSound } from "@/lib/useStonePlacementSound";
import { useWinConfetti } from "@/lib/useWinConfetti";
import { isGameOver, getWinner } from "@shared";
import { cn } from "@/lib/utils";
import { AI_DIFFICULTY_LABELS } from "@/lib/engine/tiao-engine";
import type { AIDifficulty } from "@/lib/computer-ai";

type ComputerGamePageProps = {
  auth: AuthResponse | null;
  onOpenAuth: (mode: "login" | "signup") => void;
  onLogout: () => void;
};

const DIFFICULTY_LEVELS: AIDifficulty[] = [1, 2, 3];

export function ComputerGamePage({
  auth,
  onOpenAuth,
  onLogout,
}: ComputerGamePageProps) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [difficulty, setDifficulty] = useState<AIDifficulty | null>(null);
  const computer = useComputerGame(difficulty ?? 3);

  const handleStartGame = useCallback(
    (level: AIDifficulty) => {
      setDifficulty(level);
      computer.resetLocalGame();
    },
    [computer.resetLocalGame],
  );

  const handleChangeDifficulty = useCallback(() => {
    setDifficulty(null);
    computer.resetLocalGame();
  }, [computer.resetLocalGame]);

  useStonePlacementSound(computer.localGame);
  const winner = isGameOver(computer.localGame)
    ? getWinner(computer.localGame)
    : null;
  useWinConfetti(winner);

  const localStatusTitle = winner
    ? `${formatPlayerColor(winner)} wins!`
    : computer.computerThinking
      ? "Computer thinking..."
      : `${formatPlayerColor(computer.localGame.currentTurn)} to move`;

  const paperCard =
    "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

  const boardWrapStyle = {
    maxWidth: "min(100%, calc(100dvh - 5rem))",
    aspectRatio: "1/1",
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[18rem] bg-[radial-gradient(circle_at_top,_rgba(255,247,231,0.76),_transparent_58%)]" />

      <Navbar
        mode="computer"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-[104rem] flex-col gap-5 px-4 pb-3 pt-16 sm:px-6 sm:pt-5 lg:px-6 lg:pb-4 xl:pt-2">
        {difficulty === null ? (
          <section className="flex items-center justify-center py-12">
            <Card className={cn(paperCard, "w-full max-w-md")}>
              <CardHeader>
                <GamePanelBrand />
                <CardTitle className="text-[#2b1e14]">
                  Choose Difficulty
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {DIFFICULTY_LEVELS.map((level) => (
                  <Button
                    key={level}
                    variant="secondary"
                    className="w-full border-[#dcc7a2]"
                    onClick={() => handleStartGame(level)}
                  >
                    {AI_DIFFICULTY_LABELS[level]}
                  </Button>
                ))}
              </CardContent>
            </Card>
          </section>
        ) : (
          <section className="grid gap-3 xl:gap-1.5 xl:grid-cols-[minmax(0,1fr)_17.75rem] xl:items-start">
            <div className="flex items-center justify-center xl:min-h-[calc(100dvh-1.5rem)]">
              <div
                className="relative mx-auto w-full"
                style={boardWrapStyle}
              >
                <TiaoBoard
                  state={computer.localGame}
                  selectedPiece={computer.localSelection}
                  jumpTargets={computer.localJumpTargets}
                  confirmReady={true}
                  lastMove={computer.lastMove}
                  onPointClick={computer.handleLocalBoardClick}
                  onUndoLastJump={computer.handleLocalUndoPendingJump}
                  disabled={computer.controlsDisabled}
                />
                {computer.computerThinking && (
                  <div className="pointer-events-none absolute inset-0 z-[200] flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-3 rounded-3xl border border-[#dcc7a2] bg-[#fff7ec]/95 px-5 py-3 text-sm font-semibold text-[#5d4732] shadow-lg backdrop-blur">
                        <HourglassSpinner className="text-[#7b5f3f]" />
                        AI is thinking...
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

            <div className="space-y-4 xl:max-h-[calc(100dvh-1.5rem)] xl:overflow-auto">
              <div
                className="mx-auto w-full xl:mx-0"
                style={boardWrapStyle}
              >
                <Card className={paperCard}>
                  <CardHeader>
                    <GamePanelBrand />
                    <Badge className="w-fit bg-[#edf5e4] text-[#486334]">
                      Vs AI — {AI_DIFFICULTY_LABELS[difficulty]}
                    </Badge>
                    <CardTitle className="text-[#2b1e14]">
                      {localStatusTitle}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <AnimatedScoreTile
                        label="Black (AI)"
                        value={computer.localGame.score.black}
                        pulseKey={computer.localScorePulse.black}
                        className="rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#39312b,#14100d)] p-4 text-[#f9f2e8] shadow-[0_18px_32px_-26px_rgba(0,0,0,0.9)]"
                        labelClassName="text-xs uppercase tracking-[0.24em] text-[#d9cec2]"
                      />
                      <AnimatedScoreTile
                        label="White (You)"
                        value={computer.localGame.score.white}
                        pulseKey={computer.localScorePulse.white}
                        className="rounded-3xl border border-[#d3c3ad] bg-[linear-gradient(180deg,#fffef8,#efe4d1)] p-4 text-[#2b1e14] shadow-[0_18px_32px_-26px_rgba(84,61,36,0.45)]"
                        labelClassName="text-xs uppercase tracking-[0.24em] text-[#847261]"
                      />
                    </div>

                    <div className="grid gap-2">
                      <Button
                        variant="secondary"
                        onClick={computer.handleLocalUndoTurn}
                        disabled={computer.controlsDisabled}
                      >
                        Undo turn
                      </Button>
                    </div>

                    {winner && (
                      <div className="grid gap-2 border-t border-[#dbc6a2] pt-4">
                        <Button
                          variant="secondary"
                          onClick={computer.resetLocalGame}
                        >
                          Restart board
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={handleChangeDifficulty}
                        >
                          Change difficulty
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => navigate("/")}
                        >
                          Back to lobby
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
