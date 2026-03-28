import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Navbar } from "@/components/Navbar";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { useSocialData } from "@/lib/hooks/useSocialData";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { createMultiplayerGame } from "@/lib/api";
import { toastError } from "@/lib/errors";
import { useTranslations } from "next-intl";

export function FriendsPage() {
  const t = useTranslations("friends");
  const tCommon = useTranslations("common");
  const tLobby = useTranslations("lobby");
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);

  const social = useSocialData(auth, false);
  const [inviteBusy, setInviteBusy] = useState<string | null>(null);
  const [inviteDialogFriendId, setInviteDialogFriendId] = useState<string | null>(null);
  const [inviteBoardSize, setInviteBoardSize] = useState(19);
  const [inviteScoreToWin, setInviteScoreToWin] = useState(10);

  const inviteDialogFriend = inviteDialogFriendId
    ? social.socialOverview.friends.find((f) => f.playerId === inviteDialogFriendId)
    : null;

  function openInviteDialog(friendId: string) {
    setInviteDialogFriendId(friendId);
    setInviteBoardSize(19);
    setInviteScoreToWin(10);
  }

  async function handleInviteToGame() {
    if (!inviteDialogFriendId) return;
    setInviteBusy(inviteDialogFriendId);
    try {
      const settings =
        inviteBoardSize !== 19 || inviteScoreToWin !== 10
          ? { boardSize: inviteBoardSize, scoreToWin: inviteScoreToWin }
          : undefined;
      const response = await createMultiplayerGame(settings);
      const gameId = response.snapshot.gameId;
      await social.handleSendGameInvitation(gameId, inviteDialogFriendId, 60);
      toast.success(tLobby("inviteSent"));
      setInviteDialogFriendId(null);
      router.push(`/game/${gameId}`);
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
      router.replace("/");
    }
  }, [auth, router]);

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
              <CardTitle>{t("findPlayers")}</CardTitle>
              <CardDescription>{t("findPlayersDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder={t("playerNamePlaceholder")}
                  value={social.friendSearchQuery}
                  onChange={(e) => social.setFriendSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && social.runFriendSearch()}
                />
                <Button onClick={social.runFriendSearch} disabled={social.friendSearchBusy}>
                  {tCommon("search")}
                </Button>
              </div>
              <div className="space-y-2">
                {social.friendSearchResults.map((result) => (
                  <div
                    key={result.player.playerId}
                    className="flex items-center justify-between p-2 rounded-xl bg-white/40"
                  >
                    <PlayerIdentityRow player={result.player} />
                    {result.relationship === "friend" ? (
                      <Badge variant="outline">{t("friend")}</Badge>
                    ) : result.relationship === "outgoing-request" ? (
                      <Badge variant="outline" className="text-[#8d7760]">
                        {t("pending")}
                      </Badge>
                    ) : result.relationship === "incoming-request" ? (
                      <Button
                        size="sm"
                        onClick={() => social.handleAcceptFriendRequest(result.player.playerId)}
                      >
                        {tCommon("accept")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => social.handleSendFriendRequest(result.player.playerId)}
                      >
                        {tCommon("add")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card className={paperCard}>
              <CardHeader>
                <CardTitle>{t("pending")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {social.socialOverview.incomingFriendRequests.map((req) => (
                  <div
                    key={req.playerId}
                    className="flex items-center justify-between p-3 rounded-xl bg-white/40"
                  >
                    <PlayerIdentityRow player={req} nameClassName="font-medium" />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => social.handleAcceptFriendRequest(req.playerId)}
                      >
                        {tCommon("accept")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => social.handleDeclineFriendRequest(req.playerId)}
                      >
                        {tCommon("decline")}
                      </Button>
                    </div>
                  </div>
                ))}
                {social.socialOverview.incomingFriendRequests.length === 0 && (
                  <p className="text-sm text-[#6e5b48]">{t("noPendingRequests")}</p>
                )}
              </CardContent>
            </Card>

            <Card className={paperCard}>
              <CardHeader>
                <CardTitle>{t("friends")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {social.socialOverview.friends.map((friend) => (
                  <div
                    key={friend.playerId}
                    className="flex items-center justify-between p-3 rounded-xl bg-white/40"
                  >
                    <PlayerIdentityRow
                      player={friend}
                      online={friend.online}
                      nameClassName="font-medium"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-xs"
                        onClick={() => openInviteDialog(friend.playerId)}
                      >
                        {t("inviteToGame")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-[#8d7760] hover:text-red-600"
                        onClick={() => social.handleRemoveFriend(friend.playerId)}
                        disabled={social.socialActionBusyKey === `friend-remove:${friend.playerId}`}
                      >
                        {t("unfriend")}
                      </Button>
                    </div>
                  </div>
                ))}
                {social.socialOverview.friends.length === 0 && (
                  <p className="text-sm text-[#6e5b48]">{t("emptyFriendList")}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <Dialog
        open={!!inviteDialogFriendId}
        onOpenChange={(open) => {
          if (!open) setInviteDialogFriendId(null);
        }}
        title={t("inviteToGame")}
        description={
          inviteDialogFriend
            ? t("inviteDialogDesc", { name: inviteDialogFriend.displayName })
            : undefined
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#6e5437]">
              {tLobby("boardSize")}
            </label>
            <div className="flex gap-2">
              {[9, 13, 19].map((size) => (
                <Button
                  key={size}
                  variant={inviteBoardSize === size ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setInviteBoardSize(size)}
                >
                  {size}x{size}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#6e5437]">
              {tLobby("scoreToWin")}
            </label>
            <div className="flex gap-2">
              {[5, 10, 15, 20].map((score) => (
                <Button
                  key={score}
                  variant={inviteScoreToWin === score ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setInviteScoreToWin(score)}
                >
                  {score}
                </Button>
              ))}
            </div>
          </div>
          <Button
            className="w-full"
            onClick={handleInviteToGame}
            disabled={inviteBusy === inviteDialogFriendId}
          >
            {inviteBusy === inviteDialogFriendId ? tCommon("creating") : t("createAndInvite")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
