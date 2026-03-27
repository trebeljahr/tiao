import React, { useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PlayerColor } from "@shared";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
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

const DIFFICULTY_LEVELS: AIDifficulty[] = [1, 2, 3];

export function ComputerGamePage() {
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const gameSettings = useMemo(() => {
    const bs = searchParams?.get("boardSize") ?? null;
    const stw = searchParams?.get("scoreToWin") ?? null;
    if (!bs && !stw) return undefined;
    return {
      boardSize: bs ? Number(bs) : undefined,
      scoreToWin: stw ? Number(stw) : undefined,
    };
  }, [searchParams]);
  const [navOpen, setNavOpen] = useState(false);
  const [difficulty, setDifficulty] = useState<AIDifficulty | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<AIDifficulty>(2);
  const [selectedColor, setSelectedColor] = useState<PlayerColor | "random">("random");
  const computer = useComputerGame(difficulty ?? 3, gameSettings);

  const handleStartGame = useCallback(() => {
    setDifficulty(selectedDifficulty);
    const playerColorChoice = selectedColor === "random" ? undefined : selectedColor;
    const computerCol = playerColorChoice
      ? (playerColorChoice === "white" ? "black" : "white")
      : undefined;
    computer.resetLocalGame(computerCol);
  }, [selectedDifficulty, selectedColor, computer.resetLocalGame]);

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

  const [gameOverDialogOpen, setGameOverDialogOpen] = useState(false);
  const prevGameOverRef = React.useRef(false);

  React.useEffect(() => {
    if (gameOver && !prevGameOverRef.current) {
      prevGameOverRef.current = true;
      // Small delay so confetti/particles start first
      const id = setTimeout(() => setGameOverDialogOpen(true), 600);
      return () => clearTimeout(id);
    }
    if (!gameOver) {
      prevGameOverRef.current = false;
      setGameOverDialogOpen(false);
    }
  }, [gameOver]);

  const playerWon = winner !== null && winner !== computer.computerColor;
  const gameOverTitle = isDraw ? "Draw!" : playerWon ? "You won!" : "You lost!";
  const gameOverDescription = isDraw
    ? "No moves remaining. Ready for another round?"
    : playerWon
      ? "Great game! Ready for another round?"
      : "Better luck next time. Want to try again?";

  const localStatusTitle = isDraw
    ? "Draw!"
    : winner
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
              <CardContent className="space-y-5">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#8d7760]">
                    Difficulty
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {DIFFICULTY_LEVELS.map((level) => (
                      <Button
                        key={level}
                        variant="secondary"
                        className={cn(
                          "border-[#dcc7a2]",
                          selectedDifficulty === level
                            ? "pointer-events-none border-[#6b5030] bg-[#6b5030] text-white hover:bg-[#6b5030] hover:text-white"
                            : "hover:bg-[#ede3d2]",
                        )}
                        onClick={() => setSelectedDifficulty(level)}
                      >
                        {AI_DIFFICULTY_LABELS[level]}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[#dbc6a2] pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#8d7760]">
                    Play as
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant="secondary"
                      className={cn(
                        "flex items-center gap-2 border-[#dcc7a2]",
                        selectedColor === "random"
                          ? "pointer-events-none border-[#6b5030] bg-[#6b5030] text-white hover:bg-[#6b5030] hover:text-white"
                          : "hover:bg-[#ede3d2]",
                      )}
                      onClick={() => setSelectedColor("random")}
                    >
                      <span
                        className="h-4 w-4 rounded-full border border-[#999]"
                        style={{
                          background:
                            "linear-gradient(135deg, #f4eee3 50%, #2d2622 50%)",
                        }}
                      />
                      Random
                    </Button>
                    <Button
                      variant="secondary"
                      className={cn(
                        "flex items-center gap-2 border-[#dcc7a2]",
                        selectedColor === "white"
                          ? "pointer-events-none border-[#6b5030] bg-[#6b5030] text-white hover:bg-[#6b5030] hover:text-white"
                          : "hover:bg-[#ede3d2]",
                      )}
                      onClick={() => setSelectedColor("white")}
                    >
                      <span className="h-4 w-4 rounded-full border border-[#ddd2bf] bg-[radial-gradient(circle_at_30%_28%,#fffdfa,#f4eee3_58%,#d9ccb8)]" />
                      White
                    </Button>
                    <Button
                      variant="secondary"
                      className={cn(
                        "flex items-center gap-2 border-[#dcc7a2]",
                        selectedColor === "black"
                          ? "pointer-events-none border-[#6b5030] bg-[#6b5030] text-white hover:bg-[#6b5030] hover:text-white"
                          : "hover:bg-[#ede3d2]",
                      )}
                      onClick={() => setSelectedColor("black")}
                    >
                      <span className="h-4 w-4 rounded-full border border-[#191410] bg-[radial-gradient(circle_at_30%_28%,#5d554f,#2d2622_58%,#0f0c0b)]" />
                      Black
                    </Button>
                  </div>
                </div>

                <Button
                  className="w-full"
                  onClick={handleStartGame}
                >
                  Start Game
                </Button>
              </CardContent>
            </Card>
          </section>
        ) : (
          <section className="grid gap-3 xl:min-h-[calc(100dvh-1rem)] xl:content-center xl:gap-5 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
            <div className="flex items-center justify-center xl:items-start xl:justify-end">
              <div
                className="relative isolate mx-auto w-full"
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
                  onConfirmJump={computer.handleLocalConfirmPendingJump}
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

            <div className="mx-auto w-full max-w-[calc(100dvh-5rem)] space-y-4 xl:mx-0 xl:w-auto xl:min-w-[20rem] xl:max-w-[28rem]">
              <div className="mx-auto w-full xl:mx-0">
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
                  <CardContent className="space-y-5">
                    <div className="grid grid-cols-1 gap-4">
                      <AnimatedScoreTile
                        label={computer.computerColor === "black" ? "Black (AI)" : "Black (You)"}
                        value={computer.localGame.score.black}
                        pulseKey={computer.localScorePulse.black}
                        className="rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#39312b,#14100d)] p-5 text-[#f9f2e8] shadow-[0_18px_32px_-26px_rgba(0,0,0,0.9)]"
                        labelClassName="text-xs uppercase tracking-[0.24em] text-[#d9cec2]"
                        scoreToWin={computer.localGame.scoreToWin}
                      />
                      <AnimatedScoreTile
                        label={computer.computerColor === "white" ? "White (AI)" : "White (You)"}
                        value={computer.localGame.score.white}
                        pulseKey={computer.localScorePulse.white}
                        className="rounded-3xl border border-[#d3c3ad] bg-[linear-gradient(180deg,#fffef8,#efe4d1)] p-5 text-[#2b1e14] shadow-[0_18px_32px_-26px_rgba(84,61,36,0.45)]"
                        labelClassName="text-xs uppercase tracking-[0.24em] text-[#847261]"
                        scoreToWin={computer.localGame.scoreToWin}
                      />
                    </div>

                    <div className="grid gap-2">
                      <Button
                        variant="secondary"
                        onClick={computer.handleLocalUndoTurn}
                        disabled={!computer.canUndo}
                      >
                        Undo move
                      </Button>
                    </div>

                    {winner && (
                      <div className="grid gap-2 border-t border-[#dbc6a2] pt-4">
                        <Button
                          variant="secondary"
                          onClick={() => computer.resetLocalGame()}
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
                          onClick={() => router.push("/")}
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

      <Dialog
        open={gameOverDialogOpen}
        onOpenChange={setGameOverDialogOpen}
        title={gameOverTitle}
        description={gameOverDescription}
      >
        <div className="grid gap-2">
          <Button onClick={() => { setGameOverDialogOpen(false); computer.resetLocalGame(); }}>
            {playerWon ? "Play again" : "Try again"}
          </Button>
          <Button variant="secondary" onClick={() => { setGameOverDialogOpen(false); handleChangeDifficulty(); }}>
            Change difficulty
          </Button>
          <Button variant="ghost" onClick={() => router.push("/")}>
            Back to lobby
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
