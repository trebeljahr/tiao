"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { isSteamBuild } from "@/lib/SteamBridge";

type WindowControls = {
  isFullScreen: () => Promise<boolean>;
  setFullScreen: (enabled: boolean) => Promise<void>;
  onFullScreenChanged: (cb: (enabled: boolean) => void) => () => void;
  quit: () => Promise<void>;
};

export function SteamWindowControls() {
  const t = useTranslations("desktopWindow");
  const [controls, setControls] = useState<WindowControls | null>(null);
  const [fullScreen, setFullScreen] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isSteamBuild()) return;
    const bridge = (window as unknown as { electron?: { windowControls?: WindowControls } })
      .electron?.windowControls;
    if (!bridge) return;
    setControls(bridge);
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
  }, []);

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
    <div className="mt-6 grid gap-2 border-t border-[#b69261]/22 pt-4">
      <Button
        variant="ghost"
        className="justify-start text-[#28170e]"
        disabled={fullScreen === null}
        onClick={() => void run(() => controls.setFullScreen(!fullScreen))}
      >
        {t(fullScreen ? "exitFullScreen" : "enterFullScreen")}
      </Button>
      <Button
        variant="ghost"
        className="justify-start text-[#28170e]"
        onClick={() => void run(() => controls.quit())}
      >
        {t("quit")}
      </Button>
      {failed && (
        <p role="status" className="px-3 text-sm">
          {t("actionFailed")}
        </p>
      )}
    </div>
  );
}
