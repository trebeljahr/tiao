import { useState } from "react";
import type { TournamentSettings } from "@shared";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { Navbar } from "@/components/Navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TournamentCreationForm } from "@/components/tournament/TournamentCreationForm";
import { createTournament } from "@/lib/api";
import { toastError } from "@/lib/errors";
import { useTournamentList } from "@/lib/hooks/useTournamentList";

function formatLabel(format: string): string {
  switch (format) {
    case "round-robin":
      return "Round Robin";
    case "single-elimination":
      return "Elimination";
    case "groups-knockout":
      return "Groups + KO";
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
      toastError(err.message ?? "Failed to create tournament.");
    } finally {
      setCreateBusy(false);
    }
  }

  const displayList = tab === "browse" ? publicTournaments : myTournaments;

  return (
    <>
      <Navbar
        mode="lobby"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen(!navOpen)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <div className="mx-auto max-w-3xl px-4 pb-5 pt-20">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-3xl font-bold">Tournaments</h1>
          {isAccount && (
            <Button onClick={() => setCreateOpen(true)}>
              Create Tournament
            </Button>
          )}
        </div>

        {isAccount && (
          <div className="flex gap-2 mb-4">
            {(["browse", "my"] as const).map((t) => (
              <Button
                key={t}
                variant={tab === t ? "default" : "outline"}
                size="sm"
                onClick={() => setTab(t)}
              >
                {t === "browse" ? "Browse" : "My Tournaments"}
              </Button>
            ))}
          </div>
        )}

        {loading && displayList.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading tournaments...</p>
        ) : displayList.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {tab === "my"
                ? "You haven't joined or created any tournaments yet."
                : "No public tournaments available right now."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {displayList.map((t) => (
              <Card
                key={t.tournamentId}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => router.push(`/tournament/${t.tournamentId}`)}
              >
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{t.name}</span>
                      <Badge className={statusColor(t.status)}>
                        {t.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      <span>{formatLabel(t.format)}</span>
                      <span>
                        {t.playerCount}/{t.maxPlayers} players
                      </span>
                      <span>by {t.creatorDisplayName}</span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm">
                    View
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
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
