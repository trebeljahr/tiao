import { useState, useMemo } from "react";
import type { TimeControl, PlayerColor } from "@shared";
import type { AIDifficulty } from "@/lib/computer-ai";
import type { GameConfigMode } from "@/components/game/GameConfigPanel";

export function useGameConfig(mode: GameConfigMode) {
  const [boardSize, setBoardSize] = useState(19);
  const [scoreToWin, setScoreToWin] = useState(10);
  const [timeControl, setTimeControl] = useState<TimeControl>(null);
  const [color, setColor] = useState<PlayerColor | "random">("random");
  const [difficulty, setDifficulty] = useState<AIDifficulty>(2);

  function reset() {
    setBoardSize(19);
    setScoreToWin(10);
    setTimeControl(null);
    setColor("random");
    setDifficulty(2);
  }

  const configPanelProps = useMemo(() => {
    const base = {
      mode,
      boardSize,
      onBoardSizeChange: setBoardSize,
      scoreToWin,
      onScoreToWinChange: setScoreToWin,
      timeControl,
      onTimeControlChange: setTimeControl,
    };

    if (mode === "computer") {
      return {
        ...base,
        selectedColor: color,
        onColorChange: setColor,
        difficulty,
        onDifficultyChange: setDifficulty,
      };
    }

    if (mode === "multiplayer") {
      return {
        ...base,
        selectedColor: color,
        onColorChange: setColor,
      };
    }

    return base;
  }, [mode, boardSize, scoreToWin, timeControl, color, difficulty]);

  function buildMultiplayerSettings() {
    const settings: {
      boardSize?: number;
      scoreToWin?: number;
      timeControl?: { initialMs: number; incrementMs: number };
      creatorColor?: PlayerColor;
    } = {};
    if (boardSize !== 19) settings.boardSize = boardSize;
    if (scoreToWin !== 10) settings.scoreToWin = scoreToWin;
    if (timeControl) settings.timeControl = timeControl;
    if (color !== "random") settings.creatorColor = color;
    return Object.keys(settings).length > 0 ? settings : undefined;
  }

  function buildLocalParams() {
    const params = new URLSearchParams({ autostart: "1" });
    if (boardSize !== 19) params.set("boardSize", String(boardSize));
    if (scoreToWin !== 10) params.set("scoreToWin", String(scoreToWin));
    if (timeControl) {
      params.set("tcInitial", String(timeControl.initialMs));
      params.set("tcIncrement", String(timeControl.incrementMs));
    }
    return params;
  }

  function buildComputerParams() {
    const params = new URLSearchParams({ autostart: "1" });
    if (boardSize !== 19) params.set("boardSize", String(boardSize));
    if (scoreToWin !== 10) params.set("scoreToWin", String(scoreToWin));
    params.set("difficulty", String(difficulty));
    if (color !== "random") params.set("color", color);
    return params;
  }

  return {
    reset,
    configPanelProps,
    buildMultiplayerSettings,
    buildLocalParams,
    buildComputerParams,
  };
}
