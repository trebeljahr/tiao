import type { GameConfigMode } from "@/components/game/GameConfigPanel";
import type { AIDifficulty } from "@/lib/computer-ai";
import type { PlayerColor, TimeControl } from "@shared";
import { useMemo, useState } from "react";

type InitialGameConfig = {
  boardSize?: number;
  scoreToWin?: number;
  timeControl?: TimeControl;
  color?: PlayerColor | "random";
  difficulty?: AIDifficulty;
};

export function useGameConfig(mode: GameConfigMode, initial?: InitialGameConfig) {
  // These seed the state on first render only — subsequent prop changes are
  // ignored, matching React's useState(initial) semantics. Callers that want
  // to push new values after mount should use setValues() below.
  const [boardSize, setBoardSize] = useState(initial?.boardSize ?? 19);
  const [scoreToWin, setScoreToWin] = useState(initial?.scoreToWin ?? 10);
  const [timeControl, setTimeControl] = useState<TimeControl>(initial?.timeControl ?? null);
  const [color, setColor] = useState<PlayerColor | "random">(initial?.color ?? "random");
  const [difficulty, setDifficulty] = useState<AIDifficulty>(initial?.difficulty ?? 2);

  function reset() {
    setBoardSize(19);
    setScoreToWin(10);
    setTimeControl(null);
    setColor("random");
    setDifficulty(2);
  }

  /**
   * Set multiple values at once, e.g. from URL query params on autostart.
   * Missing fields keep their current values. Used by LocalGamePage and
   * ComputerGamePage when reading ?boardSize=…&scoreToWin=…&tcInitial=…
   * so the same hook that drives the setup dialog also reflects deep-linked
   * game configuration.
   */
  function setValues(values: {
    boardSize?: number;
    scoreToWin?: number;
    timeControl?: TimeControl;
    color?: PlayerColor | "random";
    difficulty?: AIDifficulty;
  }) {
    if (values.boardSize !== undefined) setBoardSize(values.boardSize);
    if (values.scoreToWin !== undefined) setScoreToWin(values.scoreToWin);
    if (values.timeControl !== undefined) setTimeControl(values.timeControl);
    if (values.color !== undefined) setColor(values.color);
    if (values.difficulty !== undefined) setDifficulty(values.difficulty);
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
    boardSize,
    scoreToWin,
    timeControl,
    color,
    difficulty,
    reset,
    setValues,
    configPanelProps,
    buildMultiplayerSettings,
    buildLocalParams,
    buildComputerParams,
  };
}
