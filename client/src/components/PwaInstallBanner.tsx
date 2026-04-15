"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/hooks/usePwaInstall";

/**
 * Small bottom-of-screen banner that prompts the user to install Tiao as a
 * PWA. Only renders when the browser has fired `beforeinstallprompt` and the
 * user hasn't already installed or dismissed it within the cooldown window.
 */
export function PwaInstallBanner() {
  const t = useTranslations("pwaInstall");
  const { canPrompt, promptInstall, dismiss } = usePwaInstall();

  if (!canPrompt) return null;

  return (
    <div
      role="dialog"
      aria-label={t("title")}
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 sm:pb-4"
    >
      <div className="pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-xl border border-[#dbc6a2] bg-[#f5e6d0] p-4 text-[#4a3728] shadow-[0_4px_16px_rgba(74,55,40,0.18)]">
        <div className="flex items-start gap-3">
          <img src="/tiao-icon-192.png" alt="" className="h-10 w-10 flex-shrink-0 rounded-lg" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold">{t("title")}</h2>
            <p className="text-xs text-[#6e5b48]">{t("description")}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={dismiss}>
            {t("dismiss")}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void promptInstall();
            }}
          >
            {t("install")}
          </Button>
        </div>
      </div>
    </div>
  );
}
