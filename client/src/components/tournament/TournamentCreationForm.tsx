import { useState } from "react";
import type { TournamentFormat, TournamentSettings } from "@shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";

const TIME_CONTROL_PRESETS = [
  { label: "3 min", initialMs: 180_000, incrementMs: 0 },
  { label: "3+2", initialMs: 180_000, incrementMs: 2_000 },
  { label: "5 min", initialMs: 300_000, incrementMs: 0 },
  { label: "5+3", initialMs: 300_000, incrementMs: 3_000 },
  { label: "10 min", initialMs: 600_000, incrementMs: 0 },
  { label: "10+5", initialMs: 600_000, incrementMs: 5_000 },
  { label: "No limit", initialMs: 0, incrementMs: 0 },
];

const FORMAT_OPTIONS: { value: TournamentFormat; label: string; description: string }[] = [
  {
    value: "round-robin",
    label: "Round Robin",
    description: "Everyone plays everyone. Best for small groups (4-12 players).",
  },
  {
    value: "single-elimination",
    label: "Single Elimination",
    description: "Lose once and you're out. Quick and dramatic.",
  },
  {
    value: "groups-knockout",
    label: "Groups + Knockout",
    description: "Group stage then elimination bracket. Best of both worlds.",
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
    const tc = TIME_CONTROL_PRESETS[timeControlIdx];
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
      title="Create Tournament"
      description="Set up a new tournament for your friends or the community."
    >
      <div className="space-y-4">
        {step === 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Format</p>
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
              Next
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Time Control</p>
            <div className="flex flex-wrap gap-2">
              {TIME_CONTROL_PRESETS.map((tc, i) => (
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
              <label className="text-xs text-muted-foreground">Max players</label>
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
                <label className="text-xs text-muted-foreground">Group size</label>
                <div className="flex gap-2 mt-1">
                  {[3, 4].map((size) => (
                    <Button
                      key={size}
                      variant={groupSize === size ? "default" : "outline"}
                      size="sm"
                      onClick={() => setGroupSize(size)}
                    >
                      {size} players
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button className="flex-1" onClick={() => setStep(2)}>
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Tournament name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Tournament"
                maxLength={60}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Description (optional)</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A friendly competition..."
                maxLength={200}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Visibility</label>
              <div className="flex gap-2 mt-1">
                {(["public", "private"] as const).map((v) => (
                  <Button
                    key={v}
                    variant={visibility === v ? "default" : "outline"}
                    size="sm"
                    onClick={() => setVisibility(v)}
                  >
                    {v === "public" ? "Public" : "Private"}
                  </Button>
                ))}
              </div>
            </div>
            {visibility === "private" && (
              <div>
                <label className="text-xs text-muted-foreground">Invite code</label>
                <Input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="secret123"
                  maxLength={20}
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                className="flex-1"
                disabled={!name.trim() || busy}
                onClick={handleSubmit}
              >
                {busy ? "Creating..." : "Create Tournament"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
