"use client";

import { useState } from "react";
import { Toaster } from "sonner";
import { THEMES } from "@/components/game/boardThemes";
import { type GameConfigMode, GameConfigPanel } from "@/components/game/GameConfigPanel";
import { ThemePicker } from "@/components/game/ThemePicker";
import { TiaoBoard } from "@/components/game/TiaoBoard";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useGameConfig } from "@/lib/hooks/useGameConfig";
import { useLocalGame } from "@/lib/hooks/useLocalGame";
import { playUiFeedback } from "@/lib/uiClickAudio";
import { useStonePlacementSound } from "@/lib/useStonePlacementSound";
import styles from "@/views/SoundLabPage.module.css";

/** Uses the production controls and local rules engine. No network actions. */
export function SoundPlayground() {
  const [mode, setMode] = useState<GameConfigMode>("local");
  const config = useGameConfig(mode, { boardSize: 9 });
  const local = useLocalGame({ boardSize: 9, scoreToWin: 10 });
  const [dialog, setDialog] = useState<"setup" | "reset" | null>(null);
  const [showThemes, setShowThemes] = useState(false);
  const [gameId, setGameId] = useState("");
  const [validation, setValidation] = useState("");
  const validId = /^[A-Z0-9]{6}$/i.test(gameId);
  const game = local.localGame;
  useStonePlacementSound(game);
  return (
    <section className={styles.playground} aria-label="Game UI playground">
      <div className={styles.playgroundHeading}>
        <h2>Playground</h2>
        <span>Local only</span>
      </div>
      <div className={styles.gameToolbar}>
        <Button onClick={() => setDialog("setup")}>New game</Button>
        <Button
          variant="outline"
          onClick={() => setShowThemes(!showThemes)}
          aria-expanded={showThemes}
        >
          Board theme
        </Button>
        <Button
          variant="ghost"
          disabled={game.history.length === 0}
          onClick={local.handleLocalUndoTurn}
        >
          Undo
        </Button>
        <Button variant="ghost" onClick={() => setDialog("reset")}>
          Reset
        </Button>
      </div>
      {showThemes && (
        <div className={styles.themes}>
          <ThemePicker unlockedThemeIds={THEMES.map((theme) => theme.id)} />
        </div>
      )}
      <div className={styles.boardHeading}>
        <span>{game.currentTurn === "white" ? "White" : "Black"} to move</span>
        <span>
          {game.boardSize} × {game.boardSize}
        </span>
      </div>
      <div className={styles.board}>
        <TiaoBoard
          state={game}
          selectedPiece={local.localSelection}
          jumpTargets={local.localJumpTargets}
          showCoordinates
          onPointClick={local.handleLocalBoardClick}
          onUndoLastJump={local.handleLocalUndoPendingJump}
          onConfirmJump={local.handleLocalConfirmPendingJump}
        />
      </div>
      <p className={styles.hint}>
        Try a border point for an error. Start or reset a game for success.
      </p>
      <form
        className={styles.validation}
        onSubmit={(event) => {
          event.preventDefault();
          void playUiFeedback(validId ? "success" : "error");
          setValidation(validId ? "Game ID format valid" : "Use six letters or numbers");
        }}
      >
        <label htmlFor="sound-lab-game-id">Game ID</label>
        <div>
          <Input
            id="sound-lab-game-id"
            placeholder="ABC123"
            maxLength={6}
            value={gameId}
            onChange={(event) => {
              setGameId(event.target.value.toUpperCase());
              setValidation("");
            }}
            aria-invalid={validation !== "" && !validId}
            aria-describedby="sound-lab-validation"
          />
          <Button type="submit" variant="outline" data-ui-feedback="manual">
            Check ID
          </Button>
        </div>
        <p id="sound-lab-validation" role="status">
          {validation}
        </p>
      </form>
      <Dialog
        open={dialog === "setup"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="New game"
      >
        <div className="mb-5 flex gap-2">
          <Button
            variant={mode === "local" ? "default" : "outline"}
            onClick={() => setMode("local")}
          >
            Local
          </Button>
          <Button
            variant={mode === "computer" ? "default" : "outline"}
            onClick={() => setMode("computer")}
          >
            Computer setup
          </Button>
        </div>
        <GameConfigPanel
          {...config.configPanelProps}
          submitLabel="Start game"
          submitFeedback="success"
          onSubmit={() => {
            local.resetLocalGame({ boardSize: config.boardSize, scoreToWin: config.scoreToWin });
            setDialog(null);
          }}
        />
      </Dialog>
      <Dialog
        open={dialog === "reset"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="Reset game?"
      >
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button
            data-ui-feedback="success"
            onClick={() => {
              local.resetLocalGame({ boardSize: game.boardSize, scoreToWin: config.scoreToWin });
              setDialog(null);
            }}
          >
            Reset game
          </Button>
        </div>
      </Dialog>
      <Toaster position="bottom-right" />
    </section>
  );
}
