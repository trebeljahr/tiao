"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/AuthContext";
import { acknowledgeSteamJoin, getPendingSteamJoin, onSteamJoinRequested } from "@/lib/SteamBridge";

export function SteamInviteHandler() {
  const router = useRouter();
  const t = useTranslations("game");
  const lastDelivered = useRef<number | null>(null);
  const { auth, authBootstrapped, steamSetupRequired } = useAuth();
  const ready = authBootstrapped && !!auth && !steamSetupRequired && !auth.player.needsUsername;

  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    const deliver = async () => {
      const request = await getPendingSteamJoin();
      if (disposed || !request || lastDelivered.current === request.id) return;
      lastDelivered.current = request.id;
      if (request.gameId) router.push(`/game/${request.gameId}`);
      else toast.error(t("steamJoinFailed"));
      await acknowledgeSteamJoin(request.id);
    };
    const off = onSteamJoinRequested(() => void deliver());
    void deliver();
    return () => {
      disposed = true;
      off();
    };
  }, [ready, router, t]);

  return null;
}
