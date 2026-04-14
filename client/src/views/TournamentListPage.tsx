"use client";
import { useState } from "react";
import type { TournamentSettings } from "@shared";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { Navbar } from "@/components/Navbar";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { AnimatedCard } from "@/components/ui/animated-card";
import { TournamentCreationForm } from "@/components/tournament/TournamentCreationForm";
import { TournamentCard } from "@/components/tournament/TournamentCard";
import { createTournament, ApiError } from "@/lib/api";
import { toastError } from "@/lib/errors";

const MAX_ONGOING_TOURNAMENTS = 10;
import { useTournamentList } from "@/lib/hooks/useTournamentList";
import { useTranslations } from "next-intl";
import { SkeletonBlock } from "@/components/ui/skeleton";

export function TournamentListPage() {
  const t = useTranslations("tournament");
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const isAccount = auth?.player?.kind === "account";
  const { publicTournaments, myTournaments, loading, refresh: _refresh } = useTournamentList(auth);
  const [navOpen, setNavOpen] = useState(false);
  const [tab, setTab] = useState<"browse" | "my">("browse");
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);

  async function handleCreate(data: {
    name: string;
    description?: string;
    settings: TournamentSettings;
  }) {
    setCreateBusy(true);
    try {
      const { tournament } = await createTournament(data);
      setCreateOpen(false);
      router.push(`/tournament/${tournament.tournamentId}`);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === "TOURNAMENT_LIMIT_REACHED") {
        toastError(t("tournamentLimitReached", { max: MAX_ONGOING_TOURNAMENTS }));
      } else {
        toastError(err.message ?? t("failedToCreate"));
      }
    } finally {
      setCreateBusy(false);
    }
  }

  const displayList = tab === "browse" ? publicTournaments : myTournaments;

  return (
    <>
      <Navbar
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen(!navOpen)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <div className="mx-auto max-w-3xl px-4 pb-5 pt-20">
        <BackButton />
        <div className="flex flex-col gap-3 mb-6 mt-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
          {isAccount && (
            <Button className="w-full sm:w-auto" onClick={() => setCreateOpen(true)}>
              {t("createTournament")}
            </Button>
          )}
        </div>

        {isAccount && (
          <div className="flex gap-2 mb-4">
            {(["browse", "my"] as const).map((tabKey) => (
              <Button
                key={tabKey}
                variant={tab === tabKey ? "default" : "outline"}
                size="sm"
                onClick={() => setTab(tabKey)}
              >
                {tabKey === "browse" ? t("browse") : t("myTournaments")}
              </Button>
            ))}
          </div>
        )}

        <PaperCard>
          <CardContent className="space-y-3 pt-6">
            {loading && displayList.length === 0 ? (
              <div className="space-y-3 animate-pulse">
                {Array.from({ length: 3 }, (_, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-2xl border border-[#dcc7a2] bg-[#fffdf7] p-4"
                  >
                    <div className="flex flex-col gap-2">
                      <SkeletonBlock className="h-5 w-40" />
                      <SkeletonBlock className="h-3.5 w-56 bg-[#ede3d2]" />
                    </div>
                    <SkeletonBlock className="h-8 w-16 rounded-lg" />
                  </div>
                ))}
              </div>
            ) : displayList.length === 0 ? (
              <AnimatedCard delay={0}>
                <div className="py-8 text-center text-muted-foreground">
                  {tab === "my" ? t("noMyTournaments") : t("noPublicTournaments")}
                </div>
              </AnimatedCard>
            ) : (
              displayList.map((item, index) => (
                <AnimatedCard key={item.tournamentId} delay={index * 0.05}>
                  <TournamentCard
                    item={item}
                    onClick={() => router.push(`/tournament/${item.tournamentId}`)}
                  />
                </AnimatedCard>
              ))
            )}
          </CardContent>
        </PaperCard>
      </div>

      <TournamentCreationForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        busy={createBusy}
      />
    </>
  );
}
