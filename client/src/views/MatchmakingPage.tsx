"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { MultiplayerSnapshot, TimeControl } from "@shared";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { AnimatedCard } from "@/components/ui/animated-card";
import { Navbar } from "@/components/Navbar";
import { HourglassSpinner } from "@/components/game/GameShared";
import { useMatchmakingData } from "@/lib/hooks/useMatchmakingData";
import { useTranslations } from "next-intl";
import { SkeletonPage } from "@/components/ui/skeleton";

export function MatchmakingPage() {
  const t = useTranslations("matchmaking");
  const { auth, authLoading, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locationTimeControl: TimeControl | null = (() => {
    const initial = searchParams?.get("initial");
    const increment = searchParams?.get("increment");
    if (initial && increment) {
      return { initialMs: Number(initial), incrementMs: Number(increment) };
    }
    return null;
  })();
  const [navOpen, setNavOpen] = useState(false);
  const cancelledRef = useRef(false);
  const failedRef = useRef(false);

  const onMatched = useCallback(
    (snapshot: MultiplayerSnapshot) => {
      router.push(`/game/${snapshot.gameId}`);
    },
    [router],
  );

  const { matchmaking, matchmakingBusy, handleEnterMatchmaking, handleCancelMatchmaking } =
    useMatchmakingData(auth, onMatched);

  useEffect(() => {
    if (
      auth &&
      matchmaking.status === "idle" &&
      !matchmakingBusy &&
      !cancelledRef.current &&
      !failedRef.current
    ) {
      void handleEnterMatchmaking(locationTimeControl).catch(() => {
        failedRef.current = true;
      });
    }
  }, [auth, matchmaking.status, matchmakingBusy, handleEnterMatchmaking, locationTimeControl]);

  if (authLoading) {
    return <SkeletonPage />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(255,247,231,0.76),transparent_58%)]" />

      <Navbar
        mode="lobby"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 pb-5 pt-20 sm:px-6 lg:px-8 lg:pb-6 lg:pt-20">
        <AnimatedCard>
          <PaperCard>
            <CardHeader className="text-center">
              <CardTitle className="text-4xl text-[#2b1e14]">{t("title")}</CardTitle>
              <CardDescription className="text-[#6e5b48]">{t("description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 flex flex-col items-center py-8">
              {matchmaking.status === "searching" || matchmakingBusy ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <HourglassSpinner className="h-16 w-16 text-[#a6824d]" />
                    <div className="absolute inset-0 rounded-full border-4 border-[#a6824d]/20 animate-ping-slow" />
                  </div>
                  <p className="text-lg font-semibold text-[#5d4732]">{t("searching")}</p>
                  <p
                    className="text-sm text-[#7a6656]"
                    title={
                      locationTimeControl
                        ? `${Math.floor(locationTimeControl.initialMs / 60000)} ${t("minPerPlayer")}${locationTimeControl.incrementMs > 0 ? ` + ${Math.floor(locationTimeControl.incrementMs / 1000)}${t("secAddedPerMove")}` : `, ${t("noIncrement")}`}`
                        : t("noTimeLimit")
                    }
                  >
                    {locationTimeControl
                      ? `${Math.floor(locationTimeControl.initialMs / 60000)}+${Math.floor(locationTimeControl.incrementMs / 1000)}`
                      : t("unlimited")}
                  </p>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      cancelledRef.current = true;
                      await handleCancelMatchmaking();
                      router.push("/");
                    }}
                    disabled={matchmakingBusy}
                  >
                    {t("cancelSearch")}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <HourglassSpinner className="h-16 w-16 text-[#a6824d] opacity-50" />
                  <p className="text-[#6e5b48]">{t("initializing")}</p>
                </div>
              )}
            </CardContent>
          </PaperCard>
        </AnimatedCard>
      </main>
    </div>
  );
}
