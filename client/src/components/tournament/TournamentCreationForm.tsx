import { useState } from "react";
import { useTranslations } from "next-intl";
import type { TournamentFormat, TournamentSettings } from "@shared";
import { TIME_CONTROL_PRESETS } from "@shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";

const TOURNAMENT_TC_PRESETS_BASE = [
  ...TIME_CONTROL_PRESETS.filter((p) => p.initialMs >= 180_000), // 3 min+
  {
    label: "No limit",
    labelKey: "noLimit" as const,
    category: "Untimed",
    initialMs: 0,
    incrementMs: 0,
  },
];

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
  const tConfig = useTranslations("config");

  const TOURNAMENT_TC_PRESETS = TOURNAMENT_TC_PRESETS_BASE.map((p) => ({
    ...p,
    label: "labelKey" in p ? t(p.labelKey) : p.label,
  }));

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
  const [timeControlIdx, setTimeControlIdx] = useState(2); // Default: 5 min
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [inviteCode, setInviteCode] = useState("");
  const [groupSize, setGroupSize] = useState(4);

  function handleSubmit() {
    const tc = TOURNAMENT_TC_PRESETS[timeControlIdx];
    const timeControl =
      tc.initialMs === 0 ? null : { initialMs: tc.initialMs, incrementMs: tc.incrementMs };

    const settings: TournamentSettings = {
      format,
      timeControl,
      scheduling: "simultaneous",
      noShow: { type: "auto-forfeit", timeoutMs: 60_000 },
      visibility,
      minPlayers: 2,
      maxPlayers,
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
            <p className="text-sm font-medium">{tConfig("timeControl")}</p>
            <div className="flex flex-wrap gap-2">
              {TOURNAMENT_TC_PRESETS.map((tc, i) => (
                <Button
                  key={tc.label}
                  variant={timeControlIdx === i ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTimeControlIdx(i)}
                >
                  {tc.label}
                </Button>
              ))}
            </div>

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
