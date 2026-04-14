"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { AuthResponse } from "@shared";
import { cn } from "@/lib/utils";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { AnimatedCard } from "@/components/ui/animated-card";
import { UserBadge, BADGE_DEFINITIONS, useBadgeName, type BadgeId } from "@/components/UserBadge";
import { BadgeToast } from "@/components/BadgeToast";
import { updateActiveBadges } from "@/lib/api";
import { toastError } from "@/lib/errors";

export function BadgeSelector({
  auth,
  onAuthChange,
  delay = 0,
}: {
  auth: AuthResponse | null;
  onAuthChange: (auth: AuthResponse) => void;
  delay?: number;
}) {
  const t = useTranslations("profile");
  const badges = [...new Set(auth?.player.badges ?? [])] as BadgeId[];
  const activeBadges = (auth?.player.activeBadges ?? []) as BadgeId[];
  // Hooks must run unconditionally, so resolve the active-badge name up front.
  // When nothing is active we just never show the hint text.
  const activeBadgeName = useBadgeName(activeBadges[0] ?? ("supporter" as BadgeId));

  if (badges.length === 0) return null;

  const updateBadges = (next: BadgeId[]) => {
    if (!auth) return;
    const prevActive = auth.player.activeBadges;

    // Optimistic swap — reflect the change in the UI immediately.
    onAuthChange({ ...auth, player: { ...auth.player, activeBadges: next } });

    // Fire the toast immediately with the actual badge rendered inside.
    // The localized "Badge updated" title sits next to a live <UserBadge>,
    // so the user sees their new badge without waiting for the round-trip.
    if (next.length > 0) {
      toast.success(<BadgeToast badge={next[0]} title={t("badgeUpdatedShort")} />);
    } else {
      toast.success(t("badgeHiddenToast"));
    }

    void updateActiveBadges(next).catch((err) => {
      // Roll back the optimistic swap if the server rejects the update.
      onAuthChange({ ...auth, player: { ...auth.player, activeBadges: prevActive } });
      toastError(err);
    });
  };

  const selectBadge = (badgeId: BadgeId) => {
    const next = activeBadges.includes(badgeId) ? [] : [badgeId];
    updateBadges(next);
  };

  const hideAll = () => {
    updateBadges([]);
  };

  return (
    <AnimatedCard delay={delay}>
      <PaperCard>
        <CardHeader>
          <CardTitle>{t("badge")}</CardTitle>
          <CardDescription>{t("badgeDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={hideAll}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                activeBadges.length === 0
                  ? "border-[#8c7a5e] bg-[#f5ecd8] text-[#4e3d2c] shadow-xs"
                  : "border-[#dcc7a3] text-[#9a8670] hover:border-[#b69a6e]",
              )}
            >
              {t("badgeHidden")}
            </button>

            {badges.map((badgeId) => {
              const def = BADGE_DEFINITIONS[badgeId];
              if (!def) return null;
              const isActive = activeBadges.includes(badgeId);

              return (
                <button
                  key={badgeId}
                  type="button"
                  onClick={() => selectBadge(badgeId)}
                  className={cn(
                    "rounded-xl border p-2 transition-all",
                    isActive
                      ? "border-[#8c7a5e] bg-[#f5ecd8] shadow-xs"
                      : "border-transparent hover:border-[#dcc7a3]",
                  )}
                >
                  <UserBadge badge={badgeId} />
                </button>
              );
            })}
          </div>

          {activeBadges.length > 0 && (
            <p className="mt-3 text-xs text-[#9a8670]">
              {t("badgeActive", { badge: activeBadgeName })}
            </p>
          )}
        </CardContent>
      </PaperCard>
    </AnimatedCard>
  );
}
