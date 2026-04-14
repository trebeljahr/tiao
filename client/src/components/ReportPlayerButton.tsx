"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { reportPlayer, ApiError, type ReportReason } from "@/lib/api";

const REASONS: ReportReason[] = [
  "offensive_username",
  "inappropriate_profile_picture",
  "harassment",
  "other",
];

type ReportPlayerButtonProps = {
  playerId: string;
  displayName: string;
  variant?: "dark" | "light";
  className?: string;
};

export function ReportPlayerButton({
  playerId,
  displayName,
  variant = "light",
  className,
}: ReportPlayerButtonProps) {
  const t = useTranslations("report");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  function handleOpen() {
    setReason(null);
    setDetails("");
    setOpen(true);
  }

  async function handleSubmit() {
    if (!reason) return;
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
        >
          <path d="M3 2a1 1 0 0 0-1 1v1.757l1.707 1.707A1 1 0 0 0 4 7.414V16a1 1 0 1 0 2 0V7.414l1.293-1.293a1 1 0 0 0 0-1.414L5.586 3H4a1 1 0 0 0 0-2H3Zm7.586 4L9.293 4.707a1 1 0 0 1 0-1.414L10.586 2H17a1 1 0 0 1 .707 1.707L16.414 5l1.293 1.293A1 1 0 0 1 17 8h-6.414Z" />
        </svg>
      </button>

      <Dialog open={open} onOpenChange={setOpen} title={t("title", { name: displayName })}>
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
              variant="danger"
              onClick={handleSubmit}
              disabled={!reason || (reason === "other" && !details.trim()) || busy}
            >
              {busy ? t("submitting") : t("submit")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
