"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type WindowControls = {
  isFullScreen: () => Promise<boolean>;
  setFullScreen: (enabled: boolean) => Promise<void>;
  onFullScreenChanged: (cb: (enabled: boolean) => void) => () => void;
  quit: () => Promise<void>;
};

export function DesktopWindowControls({ mode = "all" }: { mode?: "all" | "fullscreen" | "quit" }) {
  const t = useTranslations("desktopWindow");
  const [controls, setControls] = useState<WindowControls | null>(null);
  const [fullScreen, setFullScreen] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const bridge = (window as unknown as { electron?: { windowControls?: WindowControls } })
      .electron?.windowControls;
    if (!bridge) return;
    setControls(bridge);
    if (mode === "quit") return;
    let active = true;
    let changed = false;
    const unsubscribe = bridge.onFullScreenChanged((enabled) => {
      changed = true;
      setFullScreen(enabled);
    });
    void bridge.isFullScreen().then(
      (enabled) => {
        if (active && !changed) setFullScreen(enabled);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [mode]);

  if (!controls) return null;

  const run = async (action: () => Promise<void>) => {
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
    }
  };

  return (
    <div
      className={
        mode === "fullscreen"
          ? "mb-5 grid gap-2 rounded-3xl border border-[#b69261]/22 bg-[rgba(255,248,232,0.94)] p-4"
          : mode === "quit"
            ? "mt-auto grid gap-2 pt-5"
            : "mt-6 grid gap-2 border-t border-[#b69261]/22 pt-4"
      }
    >
      {mode !== "quit" && (
        <>
          <p className="px-3 text-xs text-[#7a6a58]">{t("rememberFullScreen")}</p>
          <Button
            variant="ghost"
            className="justify-start text-[#28170e]"
            disabled={fullScreen === null}
            onClick={() => void run(() => controls.setFullScreen(!fullScreen))}
          >
            {t(fullScreen ? "exitFullScreen" : "enterFullScreen")}
          </Button>
        </>
      )}
      {mode !== "fullscreen" && (
        <Button
          variant="ghost"
          className="justify-start text-[#28170e]"
          onClick={() => void run(() => controls.quit())}
        >
          <svg
            aria-hidden="true"
            className="mr-1.5 h-3.5 w-3.5 shrink-0 translate-y-[1px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M13 21H4V3h9M4 3l6 3v15M14 12h8m-3-3 3 3-3 3" />
          </svg>
          {t("quit")}
        </Button>
      )}
      {failed && (
        <p role="status" className="px-3 text-sm">
          {t("actionFailed")}
        </p>
      )}
    </div>
  );
}
