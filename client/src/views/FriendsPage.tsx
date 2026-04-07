"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RequireAccount } from "@/components/RequireAccount";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Navbar } from "@/components/Navbar";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { FriendActiveGamesModal } from "@/components/FriendActiveGamesModal";
import { useSocialData } from "@/lib/hooks/useSocialData";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { GameConfigPanel } from "@/components/game/GameConfigPanel";
import type { TimeControl } from "@shared";
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
  const [activeGamesFriendId, setActiveGamesFriendId] = useState<string | null>(null);
  const [inviteBoardSize, setInviteBoardSize] = useState(19);
  const [inviteScoreToWin, setInviteScoreToWin] = useState(10);
  const [inviteTimeControl, setInviteTimeControl] = useState<TimeControl>(null);

  const inviteDialogFriend = inviteDialogFriendId
    ? social.socialOverview.friends.find((f) => f.playerId === inviteDialogFriendId)
    : null;

  const activeGamesFriend = activeGamesFriendId
    ? (social.socialOverview.friends.find((f) => f.playerId === activeGamesFriendId) ?? null)
    : null;

  function openInviteDialog(friendId: string) {
    setInviteDialogFriendId(friendId);
    setInviteBoardSize(19);
    setInviteScoreToWin(10);
    setInviteTimeControl(null);
  }

  async function handleInviteToGame() {
    if (!inviteDialogFriendId) return;
    setInviteBusy(inviteDialogFriendId);
    try {
      const settings: {
        boardSize?: number;
        scoreToWin?: number;
        timeControl?: { initialMs: number; incrementMs: number };
      } = {};
      if (inviteBoardSize !== 19) settings.boardSize = inviteBoardSize;
      if (inviteScoreToWin !== 10) settings.scoreToWin = inviteScoreToWin;
      if (inviteTimeControl) settings.timeControl = inviteTimeControl;
      const response = await createMultiplayerGame(
        Object.keys(settings).length > 0 ? settings : undefined,
      );
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

  return (
    <RequireAccount>
      {() => (
        <div className="relative min-h-screen overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(255,247,231,0.76),transparent_58%)]" />

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
              <PaperCard>
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
                        <PlayerIdentityRow player={result.player} linkToProfile />
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
              </PaperCard>

              <div className="space-y-5">
                <PaperCard>
                  <CardHeader>
                    <CardTitle>{t("pending")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[#8d7760]">
                        {t("incomingRequests")}
                      </h4>
                      {social.socialOverview.incomingFriendRequests.map((req) => (
                        <div
                          key={req.playerId}
                          className="flex items-center justify-between p-3 rounded-xl bg-white/40"
                        >
                          <PlayerIdentityRow
                            player={req}
                            nameClassName="font-medium"
                            linkToProfile
                          />
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
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[#8d7760]">
                        {t("outgoingRequests")}
                      </h4>
                      {social.socialOverview.outgoingFriendRequests.map((req) => (
                        <div
                          key={req.playerId}
                          className="flex items-center justify-between p-3 rounded-xl bg-white/40"
                        >
                          <PlayerIdentityRow
                            player={req}
                            nameClassName="font-medium"
                            linkToProfile
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs text-[#8d7760] hover:text-red-600"
                            onClick={() => social.handleCancelFriendRequest(req.playerId)}
                            disabled={
                              social.socialActionBusyKey === `friend-cancel:${req.playerId}`
                            }
                          >
                            {tCommon("cancel")}
                          </Button>
                        </div>
                      ))}
                      {social.socialOverview.outgoingFriendRequests.length === 0 && (
                        <p className="text-sm text-[#6e5b48]">{t("noOutgoingRequests")}</p>
                      )}
                    </div>
                  </CardContent>
                </PaperCard>

                <PaperCard>
                  <CardHeader>
                    <CardTitle>{t("friends")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {social.socialOverview.friends.map((friend) => (
                      <div
                        key={friend.playerId}
                        className="flex items-center justify-between gap-3 rounded-xl bg-white/40 p-3"
                      >
                        <PlayerIdentityRow
                          player={friend}
                          online={friend.online}
                          nameClassName="font-medium"
                          linkToProfile
                          className="min-w-0"
                        />
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-[#dcc7a2] hover:bg-[#faefd8]"
                            onClick={() => setActiveGamesFriendId(friend.playerId)}
                          >
                            {t("seeActiveGames")}
                          </Button>
                          <Button size="sm" onClick={() => openInviteDialog(friend.playerId)}>
                            {t("inviteToGame")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-[#8d7760] hover:text-red-600"
                            onClick={() => social.handleRemoveFriend(friend.playerId)}
                            disabled={
                              social.socialActionBusyKey === `friend-remove:${friend.playerId}`
                            }
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
                </PaperCard>
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
            <GameConfigPanel
              mode="multiplayer"
              boardSize={inviteBoardSize}
              onBoardSizeChange={setInviteBoardSize}
              scoreToWin={inviteScoreToWin}
              onScoreToWinChange={setInviteScoreToWin}
              timeControl={inviteTimeControl}
              onTimeControlChange={setInviteTimeControl}
              submitLabel={t("createAndInvite")}
              onSubmit={handleInviteToGame}
              busy={inviteBusy === inviteDialogFriendId}
            />
          </Dialog>

          <FriendActiveGamesModal
            friend={activeGamesFriend}
            open={!!activeGamesFriendId}
            onOpenChange={(open) => {
              if (!open) setActiveGamesFriendId(null);
            }}
          />
        </div>
      )}
    </RequireAccount>
  );
}
