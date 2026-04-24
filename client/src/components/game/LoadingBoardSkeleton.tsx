"use client";
import { HourglassSpinner } from "@/components/game/GameShared";
import { TiaoBoard } from "@/components/game/TiaoBoard";
import { CardContent, CardHeader } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { createInitialGameState } from "@shared";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

/**
 * Loading state for game pages — renders a real, non-interactive Tiao board
 * with a glassy "Loading…" overlay, plus a side-panel placeholder. Mirrors
 * the layout of MultiplayerGamePage so swapping in the live board on load
 * doesn't shift content.
 */
export function LoadingBoardSkeleton() {
  const t = useTranslations("common");
  const placeholderState = useMemo(() => createInitialGameState(), []);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(255,247,231,0.76),transparent_58%)]" />

      {/* Navbar placeholder */}
      <div className="flex h-14 items-center px-4">
        <SkeletonBlock className="h-8 w-8 rounded-lg animate-pulse" />
      </div>

      <main className="mx-auto flex max-w-416 flex-col gap-5 px-4 pb-3 pt-2 sm:px-6 lg:px-6 xl:pt-2">
        <section className="grid gap-3 xl:min-h-[calc(100dvh-6rem)] xl:content-center xl:gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,30rem)] xl:items-start">
          {/* Real, empty board with a glassy "Loading…" overlay */}
          <div className="flex items-center justify-center xl:items-start xl:justify-end">
            <div
              className="relative isolate mx-auto w-full max-w-[min(100%,calc(100svh-8rem))] xl:max-w-[min(100%,calc(100svh-3rem))]"
              style={{ aspectRatio: "1/1" }}
            >
              <div aria-hidden className="pointer-events-none">
                <TiaoBoard
                  state={placeholderState}
                  selectedPiece={null}
                  jumpTargets={[]}
                  disabled
                />
              </div>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="flex animate-pulse items-center gap-3 rounded-3xl border border-[#dcc7a2] bg-[#fff7ec]/80 px-5 py-3 text-sm font-semibold text-[#5d4732] shadow-lg backdrop-blur-md">
                  <HourglassSpinner className="text-[#7b5f3f]" />
                  {t("loading")}
                </div>
              </div>
            </div>
          </div>

          {/* Side panel placeholder */}
          <div className="mx-auto w-full max-w-[calc(100svh-8rem)] space-y-4 xl:mx-0 xl:w-auto xl:min-w-88 xl:max-w-120">
            <PaperCard className="animate-pulse">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-black/5 bg-black/2 py-4">
                <SkeletonBlock className="h-6 w-20 rounded-lg" />
                <SkeletonBlock className="h-5 w-16 rounded-full" />
              </CardHeader>
              <CardContent className="space-y-4 pt-5">
                <div className="grid grid-cols-1 gap-4">
                  <div className="rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#39312b,#14100d)] p-5">
                    <div className="flex items-center justify-between">
                      <SkeletonBlock className="h-5 w-16 rounded-sm bg-white/15" />
                      <SkeletonBlock className="h-8 w-8 rounded-lg bg-white/15" />
                    </div>
                    <SkeletonBlock className="mt-2 h-4 w-24 rounded-sm bg-white/10" />
                  </div>
                  <div className="rounded-3xl border border-[#d3c3ad] bg-[linear-gradient(180deg,#fffef8,#efe4d1)] p-5">
                    <div className="flex items-center justify-between">
                      <SkeletonBlock className="h-5 w-16 rounded-sm" />
                      <SkeletonBlock className="h-8 w-8 rounded-lg" />
                    </div>
                    <SkeletonBlock className="mt-2 h-4 w-24 rounded-sm bg-[#ede3d2]" />
                  </div>
                </div>
                <SkeletonBlock className="h-20 w-full rounded-2xl bg-[#ede3d2]" />
              </CardContent>
            </PaperCard>
          </div>
        </section>
      </main>
    </div>
  );
}
