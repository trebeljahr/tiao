"use client";

import type { TournamentListItem } from "@shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BackButton } from "@/components/BackButton";
import { PageLayout } from "@/components/PageLayout";
import { TournamentCard } from "@/components/tournament/TournamentCard";
import { AnimatedCard } from "@/components/ui/animated-card";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { useAuth } from "@/lib/AuthContext";
import { adminListTournaments, adminSetTournamentFeatured } from "@/lib/api";
import { toastError } from "@/lib/errors";
import { isAdmin } from "@/lib/featureGate";

/**
 * Admin view for curating the lobby tournament list. Lists every
 * tournament (public AND private) with a one-click feature / unfeature
 * toggle. Featured tournaments are pinned at the top of the public
 * lobby list for all users.
 */
export function AdminTournamentsPage() {
  const t = useTranslations("adminTournaments");
  const tCommon = useTranslations("common");
  const { auth } = useAuth();
  const router = useRouter();
  const [tournaments, setTournaments] = useState<TournamentListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { tournaments } = await adminListTournaments();
      setTournaments(tournaments);
    } catch (error) {
      toastError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin(auth)) void refresh();
  }, [auth, refresh]);

  const handleToggle = useCallback(
    async (tournamentId: string, nextFeatured: boolean) => {
      setBusyId(tournamentId);
      try {
        await adminSetTournamentFeatured(tournamentId, nextFeatured);
        setTournaments((prev) =>
          prev.map((t) =>
            t.tournamentId === tournamentId ? { ...t, isFeatured: nextFeatured } : t,
          ),
        );
        toast.success(nextFeatured ? t("featured") : t("unfeatured"));
      } catch (error) {
        toastError(error);
      } finally {
        setBusyId(null);
      }
    },
    [t],
  );

  if (!isAdmin(auth)) {
    return (
      <PageLayout
        maxWidth="max-w-2xl"
        mainClassName="items-center gap-6 pb-12 lg:px-6 lg:pb-12 lg:pt-24"
      >
        <PaperCard className="w-full">
          <CardContent className="py-12 text-center">
            <p className="text-lg font-semibold text-[#5c4a32]">{t("forbidden")}</p>
          </CardContent>
        </PaperCard>
      </PageLayout>
    );
  }

  return (
    <PageLayout maxWidth="max-w-3xl" mainClassName="gap-6 pb-12 lg:px-6 lg:pb-12 lg:pt-24">
      <BackButton />

      <h1 className="text-2xl font-bold text-[#5c4a32]">{t("title")}</h1>

      <AnimatedCard delay={0}>
        <PaperCard>
          <CardHeader>
            <CardTitle className="text-[#5c4a32]">{t("allTournaments")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && tournaments.length === 0 ? (
              <p className="text-sm text-[#6e5b48]">{tCommon("loading")}</p>
            ) : tournaments.length === 0 ? (
              <p className="text-sm text-[#6e5b48]">{t("noTournaments")}</p>
            ) : (
              <div className="space-y-2">
                {tournaments.map((tournament) => (
                  <TournamentCard
                    key={tournament.tournamentId}
                    item={tournament}
                    onClick={() => router.push(`/tournament/${tournament.tournamentId}`)}
                    showFeatured
                    extra={
                      <Button
                        variant={tournament.isFeatured ? "outline" : "default"}
                        size="sm"
                        disabled={busyId === tournament.tournamentId}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggle(tournament.tournamentId, !tournament.isFeatured);
                        }}
                        className="shrink-0"
                      >
                        {tournament.isFeatured ? t("unfeatureAction") : t("featureAction")}
                      </Button>
                    }
                  />
                ))}
              </div>
            )}
          </CardContent>
        </PaperCard>
      </AnimatedCard>
    </PageLayout>
  );
}
