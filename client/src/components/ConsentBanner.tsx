"use client";

/**
 * Cookie / analytics consent banner. Rendered at the bottom of the
 * viewport on the first visit (when consent is "pending") and stays
 * there until the user picks Accept or Reject. After that the banner
 * self-hides and the choice persists via localStorage.
 *
 * The banner only appears when the build is actually configured for
 * OpenPanel (`configured === true`). Forks, dev builds, and CI
 * deployments without analytics env vars never see it — nothing to
 * consent to.
 */

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PaperCard } from "@/components/ui/paper-card";
import { Link } from "@/i18n/navigation";
import { useAnalyticsConsent } from "@/lib/AnalyticsConsent";

export function ConsentBanner() {
  const { status, configured, grant, revoke } = useAnalyticsConsent();
  const t = useTranslations("consent");

  if (!configured) return null;
  if (status !== "pending") return null;

  return (
    // Outer wrapper is full-width but transparent — it only exists to pin
    // the card to the bottom of the viewport and add breathing room so
    // the banner doesn't kiss the page edge on desktop. The PaperCard
    // inside has a real max-width so it doesn't stretch into an awkward
    // letterbox on ultrawide monitors, and reuses the same aged-paper
    // look as the rest of the site's surfaces.
    <div
      role="dialog"
      aria-labelledby="consent-banner-title"
      aria-describedby="consent-banner-body"
      // Mobile gets extra breathing room (bigger horizontal gutters, more
      // space above so the banner doesn't feel cramped against content and
      // the buttons sit clear of the text). Desktop keeps tighter padding
      // since the card is already horizontally centered in the viewport
      // and looks balanced at its max-w-3xl width.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] px-6 pb-6 pt-12 sm:px-4 sm:pb-4 sm:pt-8"
    >
      <PaperCard className="pointer-events-auto mx-auto flex max-w-3xl flex-col gap-5 p-6 shadow-[0_12px_40px_-12px_rgba(74,55,40,0.35)] sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-4 sm:px-6 sm:py-5">
        <div className="space-y-1">
          <h2 id="consent-banner-title" className="text-sm font-semibold text-[#4a3728]">
            {t("title")}
          </h2>
          <p id="consent-banner-body" className="text-sm text-[#6e5b48]">
            {t("body")}{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-[#4a3728]">
              {t("privacyLink")}
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" onClick={revoke}>
            {t("reject")}
          </Button>
          <Button type="button" onClick={grant}>
            {t("accept")}
          </Button>
        </div>
      </PaperCard>
    </div>
  );
}
