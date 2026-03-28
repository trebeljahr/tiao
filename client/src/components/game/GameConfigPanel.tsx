import { useState } from "react";
import { useTranslations } from "next-intl";
import type { TimeControl } from "@shared";
import { BOARD_SIZE_OPTIONS, SCORE_TO_WIN_OPTIONS, TIME_CONTROL_PRESETS } from "@shared";
import type { AIDifficulty } from "@/lib/computer-ai";
import type { PlayerColor } from "@shared";
import { Button } from "@/components/ui/button";
import { NumberStepper } from "@/components/ui/number-stepper";
import { cn } from "@/lib/utils";

export type GameConfigMode = "computer" | "local" | "multiplayer" | "matchmaking" | "tournament";

type GameConfigPanelProps = {
  mode: GameConfigMode;
  boardSize: number;
  onBoardSizeChange: (size: number) => void;
  scoreToWin: number;
  onScoreToWinChange: (score: number) => void;
  timeControl: TimeControl;
  onTimeControlChange: (tc: TimeControl) => void;
  // AI-specific
  difficulty?: AIDifficulty;
  onDifficultyChange?: (d: AIDifficulty) => void;
  selectedColor?: PlayerColor | "random";
  onColorChange?: (c: PlayerColor | "random") => void;
  // Action
  submitLabel: string;
  onSubmit: () => void;
  busy?: boolean;
};

const DIFFICULTIES: AIDifficulty[] = [1, 2, 3];

function OptionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#8d7760]">
        {label}
      </p>
      {children}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      className={cn(
        "border-[#dcc7a2]",
        active
          ? "pointer-events-none !border-[#6b5030] !bg-[#6b5030] !text-white"
          : "hover:bg-[#ede3d2]",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function GameConfigPanel({
  mode,
  boardSize,
  onBoardSizeChange,
  scoreToWin,
  onScoreToWinChange,
  timeControl,
  onTimeControlChange,
  difficulty,
  onDifficultyChange,
  selectedColor,
  onColorChange,
  submitLabel,
  onSubmit,
  busy,
}: GameConfigPanelProps) {
  const t = useTranslations("config");
  const tCommon = useTranslations("common");
  const tGame = useTranslations("game");
  const showTimeControl = mode !== "computer";
  const showAI = mode === "computer";
  const tcMatch = (tc: TimeControl, preset: { initialMs: number; incrementMs: number }) =>
    tc !== null && tc.initialMs === preset.initialMs && tc.incrementMs === preset.incrementMs;

  return (
    <div className="space-y-5">
      {showAI && onDifficultyChange && (
        <OptionGroup label={t("difficulty")}>
          <div className="grid grid-cols-3 gap-2">
            {DIFFICULTIES.map((level) => (
              <ToggleButton
                key={level}
                active={difficulty === level}
                onClick={() => onDifficultyChange(level)}
              >
                {t(level === 1 ? "easy" : level === 2 ? "intermediate" : "hard")}
              </ToggleButton>
            ))}
          </div>
        </OptionGroup>
      )}

      {showAI && onColorChange && (
        <OptionGroup label={t("playAs")}>
          <div className="grid grid-cols-3 gap-2">
            <ToggleButton
              active={selectedColor === "random"}
              onClick={() => onColorChange("random")}
              className="flex items-center gap-2"
            >
              <span
                className="h-4 w-4 rounded-full border border-[#999]"
                style={{
                  background: "linear-gradient(135deg, #f4eee3 50%, #2d2622 50%)",
                }}
              />
              {t("random")}
            </ToggleButton>
            <ToggleButton
              active={selectedColor === "white"}
              onClick={() => onColorChange("white")}
              className="flex items-center gap-2"
            >
              <span className="h-4 w-4 rounded-full border border-[#ddd2bf] bg-[radial-gradient(circle_at_30%_28%,#fffdfa,#f4eee3_58%,#d9ccb8)]" />
              {tGame("white")}
            </ToggleButton>
            <ToggleButton
              active={selectedColor === "black"}
              onClick={() => onColorChange("black")}
              className="flex items-center gap-2"
            >
              <span className="h-4 w-4 rounded-full border border-[#191410] bg-[radial-gradient(circle_at_30%_28%,#5d554f,#2d2622_58%,#0f0c0b)]" />
              {tGame("black")}
            </ToggleButton>
          </div>
        </OptionGroup>
      )}

      <OptionGroup label={t("boardSize")}>
        <div className="grid grid-cols-3 gap-2">
          {BOARD_SIZE_OPTIONS.map((size) => (
            <ToggleButton
              key={size}
              active={boardSize === size}
              onClick={() => onBoardSizeChange(size)}
            >
              {size}x{size}
            </ToggleButton>
          ))}
        </div>
      </OptionGroup>

      <OptionGroup label={t("scoreToWin")}>
        <div className="grid grid-cols-4 gap-2">
          {SCORE_TO_WIN_OPTIONS.map((score) => (
            <ToggleButton
              key={score}
              active={scoreToWin === score}
              onClick={() => onScoreToWinChange(score)}
            >
              {score}
            </ToggleButton>
          ))}
        </div>
      </OptionGroup>

      {showTimeControl && (
        <TimeControlSection
          timeControl={timeControl}
          onTimeControlChange={onTimeControlChange}
          tcMatch={tcMatch}
        />
      )}

      <div className="border-t border-[#dbc6a2] pt-4">
        <Button className="w-full" onClick={onSubmit} disabled={busy}>
          {busy ? tCommon("creating") : submitLabel}
        </Button>
      </div>
    </div>
  );
}

function TimeControlSection({
  timeControl,
  onTimeControlChange,
  tcMatch,
}: {
  timeControl: TimeControl;
  onTimeControlChange: (tc: TimeControl) => void;
  tcMatch: (tc: TimeControl, preset: { initialMs: number; incrementMs: number }) => boolean;
}) {
  const t = useTranslations("config");
  const hasClock = timeControl !== null;
  const isCustom = hasClock && !TIME_CONTROL_PRESETS.some((p) => tcMatch(timeControl, p));
  const [showCustom, setShowCustom] = useState(isCustom);

  return (
    <OptionGroup label={t("timeControl")}>
      <div className="space-y-3">
        {/* Toggle: Unlimited vs With Clocks */}
        <div className="grid grid-cols-2 gap-2">
          <ToggleButton
            active={!hasClock}
            onClick={() => {
              onTimeControlChange(null);
              setShowCustom(false);
            }}
          >
            {t("unlimited")}
          </ToggleButton>
          <ToggleButton
            active={hasClock}
            onClick={() => {
              if (!hasClock) {
                onTimeControlChange({ initialMs: 300_000, incrementMs: 0 });
              }
            }}
          >
            {t("withClocks")}
          </ToggleButton>
        </div>

        {/* Preset grid + Custom (only when With Clocks) */}
        {hasClock && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {TIME_CONTROL_PRESETS.map((preset) => (
                <ToggleButton
                  key={preset.label}
                  active={!showCustom && tcMatch(timeControl, preset)}
                  onClick={() => {
                    setShowCustom(false);
                    onTimeControlChange({
                      initialMs: preset.initialMs,
                      incrementMs: preset.incrementMs,
                    });
                  }}
                  className="h-14"
                >
                  <span className="flex flex-col items-center leading-tight">
                    <span className="font-bold">{preset.label}</span>
                    <span className="text-[0.6rem] uppercase opacity-60">
                      {t(
                        preset.category.toLowerCase() as "bullet" | "blitz" | "rapid" | "classical",
                      )}
                    </span>
                  </span>
                </ToggleButton>
              ))}
            </div>
            <ToggleButton
              active={showCustom}
              onClick={() => setShowCustom(true)}
              className="w-full"
            >
              {t("custom")}
            </ToggleButton>

            {/* Custom inputs */}
            {showCustom && (
              <div className="flex flex-wrap gap-4 rounded-2xl border border-[#d8c29c] bg-[#fffaf1] p-4">
                <NumberStepper
                  label={t("timePerPlayer")}
                  unit={t("minutes")}
                  value={Math.floor((timeControl?.initialMs ?? 300_000) / 60_000)}
                  onChange={(mins) =>
                    onTimeControlChange({
                      initialMs: mins * 60_000,
                      incrementMs: timeControl?.incrementMs ?? 0,
                    })
                  }
                  min={1}
                  max={180}
                />
                <NumberStepper
                  label={t("incrementPerMove")}
                  unit={t("seconds")}
                  value={Math.round((timeControl?.incrementMs ?? 0) / 1_000)}
                  onChange={(secs) =>
                    onTimeControlChange({
                      initialMs: timeControl?.initialMs ?? 300_000,
                      incrementMs: secs * 1_000,
                    })
                  }
                  min={0}
                  max={60}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </OptionGroup>
  );
}
