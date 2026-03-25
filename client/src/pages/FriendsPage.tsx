import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import type { AuthResponse } from "@shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/Navbar";
import { PlayerOverviewAvatar } from "@/components/game/GameShared";
import { useSocialData } from "@/lib/hooks/useSocialData";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { createMultiplayerGame } from "@/lib/api";
import { toastError } from "@/lib/errors";
import { cn } from "@/lib/utils";

type FriendsPageProps = {
  auth: AuthResponse | null;
  onOpenAuth: (mode: "login" | "signup") => void;
  onLogout: () => void;
};

export function FriendsPage({ auth, onOpenAuth, onLogout }: FriendsPageProps) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);

  const social = useSocialData(auth, false);
  const [inviteBusy, setInviteBusy] = useState<string | null>(null);

  async function handleInviteToGame(friendId: string) {
    setInviteBusy(friendId);
    try {
      const response = await createMultiplayerGame();
      const gameId = response.snapshot.gameId;
      await social.handleSendGameInvitation(gameId, friendId, 60);
      toast.success("Game created & invitation sent!");
      navigate(`/game/${gameId}`);
    } catch (error) {
      toastError(error);
    } finally {
      setInviteBusy(null);
    }
  }

  useLobbyMessage((payload) => {
    if (payload.type === "social-update") {
      void social.refreshSocialOverview({ silent: true });
      void social.runFriendSearch();
    }
  });

  const paperCard =
    "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

  useEffect(() => {
    if (!auth || auth.player.kind !== "account") {
      navigate("/", { replace: true });
    }
  }, [auth, navigate]);

  if (!auth || auth.player.kind !== "account") {
    return null;
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[18rem] bg-[radial-gradient(circle_at_top,_rgba(255,247,231,0.76),_transparent_58%)]" />

      <Navbar
        mode="lobby"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen(!navOpen)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 pb-5 pt-20 sm:px-6 lg:px-8 lg:pb-6 lg:pt-20">
        <div className="grid gap-5 lg:grid-cols-[1fr_1.5fr]">
          <Card className={paperCard}>
            <CardHeader>
              <CardTitle>Find players</CardTitle>
              <CardDescription>Search by name to send friend requests.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Player name..."
                  value={social.friendSearchQuery}
                  onChange={(e) => social.setFriendSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && social.runFriendSearch()}
                />
                <Button onClick={social.runFriendSearch} disabled={social.friendSearchBusy}>Search</Button>
              </div>
              <div className="space-y-2">
                {social.friendSearchResults.map((result) => (
                  <div key={result.player.playerId} className="flex items-center justify-between p-2 rounded-xl bg-white/40">
                    <div className="flex items-center gap-2">
                      <PlayerOverviewAvatar player={result.player} />
                      <span className="text-sm font-medium">{result.player.displayName}</span>
                    </div>
                    {result.relationship === "friend" ? (
                      <Badge variant="outline">Friend</Badge>
                    ) : result.relationship === "outgoing-request" ? (
                      <Badge variant="outline" className="text-[#8d7760]">Pending</Badge>
                    ) : result.relationship === "incoming-request" ? (
                      <Button size="sm" onClick={() => social.handleAcceptFriendRequest(result.player.playerId)}>Accept</Button>
                    ) : (
                      <Button size="sm" onClick={() => social.handleSendFriendRequest(result.player.playerId)}>Add</Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card className={paperCard}>
              <CardHeader><CardTitle>Pending</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {social.socialOverview.incomingFriendRequests.map(req => (
                  <div key={req.playerId} className="flex items-center justify-between p-3 rounded-xl bg-white/40">
                    <div className="flex items-center gap-2">
                      <PlayerOverviewAvatar player={req} />
                      <span className="font-medium">{req.displayName}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => social.handleAcceptFriendRequest(req.playerId)}>Accept</Button>
                      <Button size="sm" variant="ghost" onClick={() => social.handleDeclineFriendRequest(req.playerId)}>Decline</Button>
                    </div>
                  </div>
                ))}
                {social.socialOverview.incomingFriendRequests.length === 0 && <p className="text-sm text-[#6e5b48]">No pending requests.</p>}
              </CardContent>
            </Card>

            <Card className={paperCard}>
              <CardHeader><CardTitle>Friends</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {social.socialOverview.friends.map(friend => (
                  <div key={friend.playerId} className="flex items-center justify-between p-3 rounded-xl bg-white/40">
                    <div className="flex items-center gap-2">
                      <PlayerOverviewAvatar player={friend} />
                      <span className="font-medium">{friend.displayName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={friend.online ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}>
                        {friend.online ? "Online" : "Offline"}
                      </Badge>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-xs"
                        onClick={() => handleInviteToGame(friend.playerId)}
                        disabled={inviteBusy === friend.playerId}
                      >
                        {inviteBusy === friend.playerId ? "Creating..." : "Invite"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-[#8d7760] hover:text-red-600"
                        onClick={() => social.handleRemoveFriend(friend.playerId)}
                        disabled={social.socialActionBusyKey === `friend-remove:${friend.playerId}`}
                      >
                        Unfriend
                      </Button>
                    </div>
                  </div>
                ))}
                {social.socialOverview.friends.length === 0 && <p className="text-sm text-[#6e5b48]">Your friend list is empty.</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
