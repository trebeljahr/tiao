"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import { BackButton } from "@/components/BackButton";
import { PageLayout } from "@/components/PageLayout";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { AnimatedCard } from "@/components/ui/animated-card";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { isAdmin } from "@/lib/featureGate";
import { toastError } from "@/lib/errors";
import {
  adminGetFlaggedPlayers,
  adminGetPlayerReports,
  adminDismissReports,
  type FlaggedPlayer,
  type PlayerReportEntry,
} from "@/lib/api";

export function AdminReportsPage() {
  const t = useTranslations("adminReports");
  const { auth } = useAuth();
  const [flagged, setFlagged] = useState<FlaggedPlayer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [reports, setReports] = useState<PlayerReportEntry[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadFlagged = useCallback(async () => {
    setLoading(true);
    try {
      const { players } = await adminGetFlaggedPlayers();
      setFlagged(players);
      setLoaded(true);
    } catch (error) {
      toastError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleExpand = useCallback(
    async (playerId: string) => {
      if (expandedPlayer === playerId) {
        setExpandedPlayer(null);
        return;
      }
      setExpandedPlayer(playerId);
      setReportsLoading(true);
      try {
        const { reports: r } = await adminGetPlayerReports(playerId);
        setReports(r);
      } catch (error) {
        toastError(error);
      } finally {
        setReportsLoading(false);
      }
    },
    [expandedPlayer],
  );

  const handleDismiss = useCallback(
    async (playerId: string) => {
      setBusy(playerId);
      try {
        await adminDismissReports(playerId);
        setFlagged((prev) => prev.filter((p) => p.playerId !== playerId));
        setExpandedPlayer(null);
        toast.success(t("dismissed"));
      } catch (error) {
        toastError(error);
      } finally {
        setBusy(null);
      }
    },
    [t],
  );

  if (!auth || !isAdmin(auth)) {
    return (
      <PageLayout>
        <p className="text-center text-muted-foreground">{t("forbidden")}</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <BackButton />
      <PaperCard className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="font-display text-3xl">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!loaded ? (
            <Button onClick={loadFlagged} disabled={loading}>
              {loading ? t("loading") : t("loadFlagged")}
            </Button>
          ) : flagged.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-muted-foreground">{t("noFlagged")}</p>
              <Button variant="outline" size="sm" onClick={loadFlagged} disabled={loading}>
                {t("refresh")}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {t("flaggedCount", { count: flagged.length })}
                </p>
                <Button variant="outline" size="sm" onClick={loadFlagged} disabled={loading}>
                  {t("refresh")}
                </Button>
              </div>
              <div className="space-y-3">
                {flagged.map((player, i) => (
                  <AnimatedCard key={player.playerId} delay={i * 0.05}>
                    <div className="rounded-2xl border border-[#d8c29c] bg-[#fffaf1]">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[#f5edd8]/50 rounded-2xl transition-colors"
                        onClick={() => handleExpand(player.playerId)}
                      >
                        <PlayerIdentityRow
                          player={player}
                          linkToProfile={false}
                          friendVariant="light"
                          className="gap-3"
                        />
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                            {t("reportsCount", { count: player.reportCount })}
                          </span>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className={`h-4 w-4 text-[#8b7356] transition-transform ${expandedPlayer === player.playerId ? "rotate-180" : ""}`}
                          >
                            <path
                              fillRule="evenodd"
                              d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      </button>

                      {expandedPlayer === player.playerId && (
                        <div className="border-t border-[#d8c29c] px-4 py-3 space-y-3">
                          {reportsLoading ? (
                            <p className="text-sm text-muted-foreground">{t("loading")}</p>
                          ) : reports.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t("noReports")}</p>
                          ) : (
                            <div className="space-y-2">
                              {reports.map((report) => (
                                <div
                                  key={report.id}
                                  className="rounded-xl bg-white/60 px-3 py-2 text-sm"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium">
                                      {t(`reason_${report.reason}`)}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(report.createdAt).toLocaleDateString()}
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {t("reportedBy", { name: report.reporterName })}
                                  </p>
                                  {report.details && (
                                    <p className="mt-1 text-xs italic text-muted-foreground">
                                      &ldquo;{report.details}&rdquo;
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDismiss(player.playerId)}
                            disabled={busy === player.playerId}
                          >
                            {busy === player.playerId ? t("dismissing") : t("dismiss")}
                          </Button>
                        </div>
                      )}
                    </div>
                  </AnimatedCard>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </PaperCard>
    </PageLayout>
  );
}
