"use client";
import { useState } from "react";
import type { TournamentSettings } from "@shared";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { Navbar } from "@/components/Navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { AnimatedCard } from "@/components/ui/animated-card";
import { TournamentCreationForm } from "@/components/tournament/TournamentCreationForm";
import { createTournament } from "@/lib/api";
import { toastError } from "@/lib/errors";
import { useTournamentList } from "@/lib/hooks/useTournamentList";
import { useTranslations } from "next-intl";
import { SkeletonBlock } from "@/components/ui/skeleton";

function formatLabel(format: string, t: (key: string) => string): string {
  switch (format) {
    case "round-robin":
      return t("roundRobin");
    case "single-elimination":
      return t("elimination");
    case "groups-knockout":
      return t("groupsKo");
    default:
      return format;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "registration":
      return "border-green-400 bg-green-50 text-green-700";
    case "active":
      return "border-blue-400 bg-blue-50 text-blue-700";
    case "finished":
      return "border-slate-300 bg-slate-50 text-slate-600";
    case "cancelled":
      return "border-red-300 bg-red-50 text-red-600";
    default:
      return "";
  }
}

export function TournamentListPage() {
  const t = useTranslations("tournament");
  const tCommon = useTranslations("common");
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
      toastError(err.message ?? t("failedToCreate"));
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
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
          {isAccount && (
            <Button onClick={() => setCreateOpen(true)}>{t("createTournament")}</Button>
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
                  <Card
                    className="cursor-pointer hover:shadow-md transition-shadow rounded-2xl"
                    onClick={() => router.push(`/tournament/${item.tournamentId}`)}
                  >
                    <CardContent className="flex items-center justify-between gap-4 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{item.name}</span>
                          <Badge className={statusColor(item.status)}>{item.status}</Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                          <span>{formatLabel(item.format, t)}</span>
                          <span>
                            {t("players", { count: item.playerCount, max: item.maxPlayers })}
                          </span>
                          <span>{t("by", { name: item.creatorDisplayName })}</span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm">
                        {tCommon("view")}
                      </Button>
                    </CardContent>
                  </Card>
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
