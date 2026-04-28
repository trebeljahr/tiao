"use client";

/**
 * Cookie / analytics consent banner. Rendered at the bottom of the
 * viewport on the first visit (when consent is "pending") and stays
 * there until the user picks Accept or Reject. After that the banner
 * animates out and the choice persists via localStorage.
 *
 * The banner only appears when the build is actually configured for
 * OpenPanel (`configured === true`). Forks, dev builds, and CI
 * deployments without analytics env vars never see it — nothing to
 * consent to.
 *
 * To avoid a flash for returning users whose choice is already stored
 * in localStorage, the banner waits for the consent provider to
 * hydrate before rendering at all.
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PaperCard } from "@/components/ui/paper-card";
import { Link } from "@/i18n/navigation";
import { useAnalyticsConsent } from "@/lib/AnalyticsConsent";

export function ConsentBanner() {
  const { status, hydrated, configured, grant, revoke } = useAnalyticsConsent();
  const t = useTranslations("consent");

  // Whether the banner is currently visible (controls the CSS transition).
  // Starts false so the first render is off-screen, then flips to true
  // in an effect to trigger the slide-in animation.
  const [visible, setVisible] = useState(false);

  const shouldShow = configured && hydrated && status === "pending";

  // Trigger the slide-in after the banner mounts. Double-rAF ensures
  // the browser has actually painted the initial off-screen frame before
  // we flip to visible, so the CSS transition fires reliably.
  useEffect(() => {
    if (!shouldShow) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setVisible(true);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [shouldShow]);

  // When the user picks accept/reject, `status` flips away from "pending"
  // and `shouldShow` becomes false. We want to animate out first, so we
  // track a `dismissed` flag and delay unmount until the transition ends.
  const [dismissed, setDismissed] = useState(false);

  // Detect external status changes (e.g. logging into an account that
  // already accepted consent) while the banner is visible, and animate
  // out before unmounting.
  useEffect(() => {
    if (!visible || status === "pending") return;
    setVisible(false);
    setDismissed(true);
    const id = setTimeout(() => setDismissed(false), 300);
    return () => clearTimeout(id);
  }, [visible, status]);

  // Sequence the exit animation and the actual consent flip:
  //   1. Flip `visible` off so the CSS transition starts fading the card.
  //   2. Flip `dismissed` on so the render guard keeps us mounted through
  //      the 300ms transition even after `status` changes away from
  //      "pending" (see the second early-return below).
  //   3. After the transition finishes, flip the consent state AND reset
  //      `dismissed` back to false so the component actually unmounts.
  //
  // Resetting `dismissed` is the critical bit — without it, the banner's
  // DOM stays mounted forever after the first accept/reject. The outer
  // wrapper is pointer-events-none but the inner PaperCard is
  // pointer-events-auto, so a left-mounted (invisible) card at the
  // bottom of the viewport silently swallowed every click/tap in that
  // rectangle. (Reported in prod after the consent flow: users couldn't
  // click anything near the bottom of the screen after dismissing.)
  function handleGrant() {
    setVisible(false);
    setDismissed(true);
    setTimeout(() => {
      grant();
      setDismissed(false);
    }, 300);
  }

  function handleRevoke() {
    setVisible(false);
    setDismissed(true);
    setTimeout(() => {
      revoke();
      setDismissed(false);
    }, 300);
  }

  // Don't render at all if not configured, not hydrated, or already
  // dismissed (after exit animation completes).
  if (!configured || !hydrated) return null;
  if (status !== "pending" && !dismissed) return null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: intentional ARIA role on container; semantic element refactor deferred
    <div
      role="dialog"
      aria-labelledby="consent-banner-title"
      aria-describedby="consent-banner-body"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] px-6 pb-6 pt-12 sm:px-4 sm:pb-4 sm:pt-8"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(1rem)",
        transition: "opacity 300ms ease, transform 300ms ease",
      }}
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
          <Button type="button" variant="outline" onClick={handleRevoke}>
            {t("reject")}
          </Button>
          <Button type="button" onClick={handleGrant}>
            {t("accept")}
          </Button>
        </div>
      </PaperCard>
    </div>
  );
}
