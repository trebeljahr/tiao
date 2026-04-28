"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ApiError, type ReportReason, reportPlayer } from "@/lib/api";
import { cn } from "@/lib/utils";

const REASONS: ReportReason[] = [
  "offensive_username",
  "inappropriate_profile_picture",
  "harassment",
  "other",
];

type ReportablePlayer = {
  playerId?: string;
  displayName?: string;
  profilePicture?: string;
  activeBadges?: string[];
  rating?: number;
};

type ReportPlayerButtonProps = {
  player: ReportablePlayer;
  variant?: "dark" | "light";
  className?: string;
};

export function ReportPlayerButton({
  player,
  variant = "light",
  className,
}: ReportPlayerButtonProps) {
  const t = useTranslations("report");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const playerId = player.playerId;
  const displayName = player.displayName;
  // Caller already gates on playerId + displayName being present, but keep a
  // defensive check so the component never crashes on a half-populated seat.
  if (!playerId || !displayName) return null;

  function handleOpen() {
    setStep("choose");
    setReason(null);
    setDetails("");
    setOpen(true);
  }

  function handleNext() {
    if (!reason) return;
    if (reason === "other" && !details.trim()) return;
    setStep("confirm");
  }

  async function handleSubmit() {
    // Re-check playerId inside the closure so TypeScript narrows it to
    // `string` here. The early return above guarantees it at render time,
    // but TS conservatively un-narrows closure captures across function
    // boundaries.
    if (!reason || !playerId) return;
    setBusy(true);
    try {
      await reportPlayer(playerId, reason, reason === "other" ? details : undefined);
      toast.success(t("submitted"));
      setOpen(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "DUPLICATE_REPORT") {
        toast.error(t("duplicate"));
      } else {
        toast.error(err instanceof ApiError ? err.message : t("error"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        title={t("reportPlayer")}
        onClick={handleOpen}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full p-1 transition-colors",
          variant === "light"
            ? "text-black/30 hover:bg-black/10 hover:text-red-600"
            : "text-white/30 hover:bg-white/10 hover:text-red-400",
          className,
        )}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M3 2.75a.75.75 0 0 0-1.5 0v14.5a.75.75 0 0 0 1.5 0v-4.392l1.657-.348a6.449 6.449 0 0 1 4.271.572 7.948 7.948 0 0 0 5.965.524l2.078-.64A.75.75 0 0 0 17.5 12.25v-8.5a.75.75 0 0 0-.904-.734l-2.38.501a7.25 7.25 0 0 1-4.186-.363l-.502-.2a8.75 8.75 0 0 0-5.053-.439L3 2.614V2.75Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      <Dialog open={open} onOpenChange={setOpen} title={t("title")}>
        {/* Who is being reported — avatar + name + badge (no rating/elo,
            no profile link; this is a moderation flow, not discovery). */}
        <div className="mb-4 rounded-2xl border border-[#e3d0ab] bg-[#fffaf1] px-3 py-2">
          <PlayerIdentityRow
            player={player}
            avatarClassName="h-10 w-10"
            linkToProfile={false}
            hideRating
            nameClassName="text-base font-semibold text-[#2b1e14]"
          />
        </div>
        {step === "choose" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t("description")}</p>

            <div className="flex flex-col gap-2">
              {REASONS.map((r) => (
                <label
                  key={r}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors",
                    reason === r
                      ? "border-[#8b7356] bg-[#8b7356]/10"
                      : "border-border hover:border-[#8b7356]/50",
                  )}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r}
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    className="accent-[#8b7356]"
                  />
                  {t(`reason_${r}`)}
                </label>
              ))}
            </div>

            {reason === "other" && (
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder={t("detailsPlaceholder")}
                maxLength={500}
                rows={3}
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-[#8b7356] focus:outline-none focus:ring-1 focus:ring-[#8b7356]"
              />
            )}

            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button
                variant="default"
                onClick={handleNext}
                disabled={!reason || (reason === "other" && !details.trim())}
              >
                {t("next")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">{t("confirmHeading")}</p>
              <p className="mt-2 text-sm text-amber-800">
                {t("confirmBody", { name: displayName })}
              </p>
              <div className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm">
                <span className="font-medium">{t("confirmReasonLabel")}:</span>{" "}
                {reason ? t(`reason_${reason}`) : ""}
              </div>
              {reason === "other" && details && (
                <div className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-sm italic text-muted-foreground">
                  &ldquo;{details}&rdquo;
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep("choose")} disabled={busy}>
                {t("back")}
              </Button>
              <Button variant="danger" onClick={handleSubmit} disabled={busy}>
                {busy ? t("submitting") : t("confirmSubmit")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
