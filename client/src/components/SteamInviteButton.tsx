"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  hasSteamInviteBridge,
  isSteamActive,
  openSteamInviteDialog,
  setSteamInviteGame,
} from "@/lib/SteamBridge";

/** Mounted only for a participant in a waiting, non-tournament room. */
export function SteamInviteButton({ gameId }: { gameId: string }) {
  const t = useTranslations("game");
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!hasSteamInviteBridge()) return;
    let disposed = false;
    void isSteamActive().then((active) => {
      if (!disposed) setAvailable(active);
    });
    void setSteamInviteGame(gameId);
    return () => {
      disposed = true;
      void setSteamInviteGame(null);
    };
  }, [gameId]);

  if (!available) return null;
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        className="w-full border-[#dcc7a2]"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          const opened = await openSteamInviteDialog();
          setFailed(!opened);
          setBusy(false);
        }}
      >
        {t("inviteSteamFriends")}
      </Button>
      {failed && (
        <p role="status" className="text-sm text-[#7a6656]">
          {t("steamInviteFailed")}
        </p>
      )}
    </div>
  );
}
