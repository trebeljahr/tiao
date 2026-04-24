"use client";
import { useOnlineStatus } from "@/lib/hooks/useOnlineStatus";
import { useTranslations } from "next-intl";

type ElectronBridge = { isElectron?: boolean };

function isElectronRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return (window as unknown as { electron?: ElectronBridge }).electron?.isElectron === true;
}

/**
 * A small yellow banner shown at the top of every desktop page when
 * the network is unreachable.  Hidden on the web (browsers have their
 * own offline indicator) and when currently online.
 *
 * Renders nothing during SSR and on the very first mount on desktop —
 * the default state from `useOnlineStatus` is "online" based on
 * `navigator.onLine`, so the banner only appears if a later health
 * poll or offline event flips the signal.
 */
export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const t = useTranslations("desktop.offline");

  if (isOnline) return null;
  if (!isElectronRuntime()) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full border-b border-amber-400 bg-amber-100/90 px-4 py-2 text-sm text-amber-900 backdrop-blur"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
        <span>{t("banner")}</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded border border-amber-600 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-200"
        >
          {t("retryNow")}
        </button>
      </div>
    </div>
  );
}
