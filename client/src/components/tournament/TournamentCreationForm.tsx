import { GameConfigPanel } from "@/components/game/GameConfigPanel";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { TimeControl, TournamentFormat, TournamentSettings } from "@shared";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function TournamentCreationForm({
  open,
  onOpenChange,
  onSubmit,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string; description?: string; settings: TournamentSettings }) => void;
  busy?: boolean;
}) {
  const t = useTranslations("tournament");
  const tCommon = useTranslations("common");

  const FORMAT_OPTIONS: { value: TournamentFormat; label: string; description: string }[] = [
    {
      value: "round-robin",
      label: t("roundRobin"),
      description: t("roundRobinDesc"),
    },
    {
      value: "single-elimination",
      label: t("eliminationFull"),
      description: t("eliminationDesc"),
    },
    {
      value: "groups-knockout",
      label: t("groupsKnockout"),
      description: t("groupsKnockoutDesc"),
    },
  ];

  const [step, setStep] = useState(0);
  const [format, setFormat] = useState<TournamentFormat>("single-elimination");
  const [boardSize, setBoardSize] = useState(19);
  const [scoreToWin, setScoreToWin] = useState(10);
  const [timeControl, setTimeControl] = useState<TimeControl>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [inviteCode, setInviteCode] = useState("");
  const [groupSize, setGroupSize] = useState(4);

  function handleSubmit() {
    const settings: TournamentSettings = {
      format,
      timeControl,
      scheduling: "simultaneous",
      noShow: { type: "auto-forfeit", timeoutMs: 60_000 },
      visibility,
      minPlayers: 2,
      maxPlayers,
      ...(boardSize !== 19 ? { boardSize } : {}),
      ...(scoreToWin !== 10 ? { scoreToWin } : {}),
      ...(format === "groups-knockout" ? { groupSize } : {}),
      ...(visibility === "private" && inviteCode ? { inviteCode } : {}),
    };

    onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      settings,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("setupTitle")}
      description={t("setupDesc")}
    >
      <div className="space-y-4">
        {step === 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">{t("format")}</p>
            {FORMAT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`w-full rounded-xl border p-3 text-left transition ${
                  format === opt.value
                    ? "border-amber-400 bg-amber-50/50"
                    : "border-white/60 bg-white/30 hover:bg-white/50"
                }`}
                onClick={() => setFormat(opt.value)}
              >
                <div className="font-medium text-sm">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.description}</div>
              </button>
            ))}
            <Button className="w-full" onClick={() => setStep(1)}>
              {tCommon("next")}
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("gameSettingsHint")}</p>

            <GameConfigPanel
              mode="tournament"
              boardSize={boardSize}
              onBoardSizeChange={setBoardSize}
              scoreToWin={scoreToWin}
              onScoreToWinChange={setScoreToWin}
              timeControl={timeControl}
              onTimeControlChange={setTimeControl}
              submitLabel=""
              onSubmit={() => {}}
            />

            <div>
              <label className="text-xs text-muted-foreground">{t("maxPlayers")}</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {[4, 8, 16, 32, 64].map((n) => (
                  <Button
                    key={n}
                    variant={maxPlayers === n ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMaxPlayers(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>

            {format === "groups-knockout" && (
              <div>
                <label className="text-xs text-muted-foreground">{t("groupSize")}</label>
                <div className="flex gap-2 mt-1">
                  {[3, 4].map((size) => (
                    <Button
                      key={size}
                      variant={groupSize === size ? "default" : "outline"}
                      size="sm"
                      onClick={() => setGroupSize(size)}
                    >
                      {t("nPlayers", { n: size })}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep(0)}>
                {tCommon("back")}
              </Button>
              <Button className="flex-1" onClick={() => setStep(2)}>
                {tCommon("next")}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">{t("tournamentName")}</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("tournamentNamePlaceholder")}
                maxLength={60}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("descriptionOptional")}</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("descriptionPlaceholder")}
                maxLength={200}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("visibility")}</label>
              <div className="flex gap-2 mt-1">
                {(["public", "private"] as const).map((v) => (
                  <Button
                    key={v}
                    variant={visibility === v ? "default" : "outline"}
                    size="sm"
                    onClick={() => setVisibility(v)}
                  >
                    {v === "public" ? t("public") : t("private")}
                  </Button>
                ))}
              </div>
            </div>
            {visibility === "private" && (
              <div>
                <label className="text-xs text-muted-foreground">{t("inviteCode")}</label>
                <Input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder={t("inviteCodePlaceholder")}
                  maxLength={20}
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                {tCommon("back")}
              </Button>
              <Button className="flex-1" disabled={!name.trim() || busy} onClick={handleSubmit}>
                {busy ? tCommon("creating") : t("createTournament")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
