import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { useAuth } from "@/lib/AuthContext";
import {
  createDataExport,
  deleteDataExport,
  getDataExportDownloadUrl,
  listDataExports,
  type UserExportRow,
} from "@/lib/api";
import { readableError, toastError } from "@/lib/errors";
import { useLobbyMessage } from "@/lib/LobbySocketContext";

export function DataExportCard() {
  const t = useTranslations("dataExport");
  const tCommon = useTranslations("common");
  const { auth } = useAuth();
  const [exports, setExports] = useState<UserExportRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const loadedRef = useRef(false);

  // Only real accounts have export rows — guests never hit the endpoint.
  const isAccount = auth?.player.kind === "account";

  const load = useCallback(async () => {
    if (!isAccount) return;
    try {
      const res = await listDataExports();
      setExports(res.exports);
    } catch (error) {
      toastError(readableError(error));
    }
  }, [isAccount]);

  // Load exports exactly once when the component mounts and auth is ready.
  // Subsequent updates come via the websocket `export-update` message below.
  useEffect(() => {
    if (!isAccount || loadedRef.current) return;
    loadedRef.current = true;
    void load();
  }, [isAccount, load]);

  // Server pushes `export-update` on the lobby socket whenever a row
  // transitions state (pending → running → ready/failed). Splice the
  // update straight into local state — this is the fast path.
  //
  // We ALSO listen for the synthetic `lobby:open` event the socket
  // emits on every (re)connect. On mobile the WS can silently blip
  // during a wifi↔5G handover or a carrier NAT idle-kill and reconnect
  // within seconds — totally invisible to the user — and any broadcast
  // that fires inside that gap is permanently lost to this client. The
  // `lobby:open` signal is our cue to pull fresh state from REST so the
  // card doesn't sit at "preparing…" forever while the row in Mongo is
  // already "ready". No polling needed.
  useLobbyMessage((payload) => {
    if (payload.type === "lobby:open") {
      void load();
      return;
    }
    if (payload.type !== "export-update") return;
    const incoming = payload.export as UserExportRow | undefined;
    if (!incoming) return;
    setExports((prev) => {
      if (!prev) return [incoming];
      const idx = prev.findIndex((e) => e.id === incoming.id);
      if (idx === -1) return [incoming, ...prev];
      const next = prev.slice();
      next[idx] = incoming;
      return next;
    });
  });

  // Refetch when the tab becomes visible. Covers the case where the OS
  // suspends JS on a backgrounded mobile tab (timers and WS messages
  // are throttled or dropped) — foregrounding the tab is the signal
  // that the user cares again, so re-sync from REST.
  useEffect(() => {
    if (!isAccount) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isAccount, load]);

  async function handleRequest() {
    setBusy(true);
    try {
      await createDataExport();
      toast.success(t("requestedToast"));
      await load();
    } catch (error) {
      toastError(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(id: string) {
    try {
      const { url } = await getDataExportDownloadUrl(id);
      window.location.href = url;
    } catch (error) {
      toastError(readableError(error));
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteDataExport(id);
      setConfirmDeleteId(null);
      await load();
    } catch (error) {
      toastError(readableError(error));
    }
  }

  // Belt-and-braces: this card is already rendered inside an
  // account-only branch in the main JSX, but a direct early return here
  // makes the gate obvious at the component level too, and prevents any
  // future refactor from accidentally rendering it for guests.
  if (!isAccount) return null;

  const active = exports?.find(
    (e) => e.status === "pending" || e.status === "running" || e.status === "ready",
  );
  const isPreparing = active?.status === "pending" || active?.status === "running";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {active ? (
          <div className="relative rounded-lg border border-[#dbc6a2] bg-[#f5e6d0]/40 px-4 py-3 text-sm">
            <button
              type="button"
              onClick={() => setConfirmDeleteId(active.id)}
              className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-[#6e5b48] transition-colors hover:bg-[rgba(0,0,0,0.06)] hover:text-[#28170e]"
              aria-label={tCommon("delete")}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
            {active.status === "pending" || active.status === "running" ? (
              <p className="pr-8 text-[#6e5b48]">{t("statusPreparing")}</p>
            ) : active.status === "ready" ? (
              <div className="space-y-2">
                <p className="pr-8 text-[#4a3728]">
                  {t("statusReady", {
                    expiresAt: new Date(active.expiresAt).toLocaleDateString(),
                  })}
                </p>
                <Button type="button" onClick={() => handleDownload(active.id)} className="w-full">
                  {t("download")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="text-xs text-[#6e5b48]">{t("note")}</p>
        <Button
          type="button"
          onClick={handleRequest}
          disabled={busy || isPreparing}
          className="w-full"
        >
          {busy ? tCommon("saving") : t("request")}
        </Button>
      </CardContent>

      <Dialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
        title={t("deleteConfirmTitle")}
        description={t("deleteConfirmDesc")}
      >
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => setConfirmDeleteId(null)}>
            {tCommon("cancel")}
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}
          >
            {tCommon("delete")}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
