import React, { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import type { AuthResponse, PlayerColor } from "@shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Navbar } from "@/components/Navbar";
import { TiaoBoard } from "@/components/game/TiaoBoard";
import {
  GamePanelBrand,
  AnimatedScoreTile,
  formatPlayerColor,
  HourglassSpinner,
  RoomCodeCopyPill,
  ShareLinkCopyPill,
  PlayerOverviewAvatar,
  EmptySeatAvatar,
  formatPlayerName,
} from "@/components/game/GameShared";
import { useMultiplayerGame } from "@/lib/hooks/useMultiplayerGame";
import { useSocialData } from "@/lib/hooks/useSocialData";
import { useLobbyMessage } from "@/lib/LobbySocketContext";
import { useStonePlacementSound } from "@/lib/useStonePlacementSound";
import { useWinConfetti } from "@/lib/useWinConfetti";
import { isGameOver, getWinner, getJumpTargets, arePositionsEqual } from "@shared";
import { cn } from "@/lib/utils";
import { accessMultiplayerGame } from "@/lib/api";

type MultiplayerGamePageProps = {
  auth: AuthResponse | null;
  onOpenAuth: (mode: "login" | "signup") => void;
  onLogout: () => void;
};

export function MultiplayerGamePage({ auth, onOpenAuth, onLogout }: MultiplayerGamePageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { gameId } = useParams<{ gameId: string }>();
  const [navOpen, setNavOpen] = useState(false);

  const websocketDebugEnabled = new URLSearchParams(location.search).has("wsDebug");

  const multi = useMultiplayerGame(auth, gameId ?? null, {
    websocketDebugEnabled,
  });

  const {
    multiplayerSnapshot,
    multiplayerSelection,
    connectionState,
    connectToRoom,
    sendMultiplayerMessage,
    setMultiplayerSelection,
    multiplayerBusy,
    setMultiplayerBusy,
  } = multi;

  const social = useSocialData(auth, false);
  const liveSocialOverview = social.socialOverview;

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState<string | null>(null);

  // Real-time social updates (friend online status, invitation state)
  useLobbyMessage((payload) => {
    if (payload.type === "social-update") {
      void social.refreshSocialOverview({ silent: true });
    }
  });

  async function handleInviteFriend(friendId: string) {
    if (!gameId) return;
    setInviteBusy(friendId);
    try {
      await social.handleSendGameInvitation(gameId, friendId, 60);
      toast.success("Invitation sent!");
    } catch {
      // handleSendGameInvitation already toasts errors
    } finally {
      setInviteBusy(null);
    }
  }

  useEffect(() => {
    if (!auth || !gameId) return;

    let cancelled = false;
    async function loadGame() {
      setMultiplayerBusy(true);
      try {
        const response = await accessMultiplayerGame(gameId);
        if (!cancelled) {
          connectToRoom(response.snapshot);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error("Failed to load game");
          navigate("/");
        }
      } finally {
        if (!cancelled) setMultiplayerBusy(false);
      }
    }

    if (connectionState === "idle") {
      void loadGame();
    }

    return () => { cancelled = true; };
  }, [auth, gameId, connectionState, connectToRoom, navigate, setMultiplayerBusy]);

  useStonePlacementSound(multiplayerSnapshot?.state ?? null);
  const winner = multiplayerSnapshot ? (isGameOver(multiplayerSnapshot.state) ? getWinner(multiplayerSnapshot.state) : null) : null;
  useWinConfetti(winner);

  const playerSeat = multiplayerSnapshot && auth
    ? (Object.entries(multiplayerSnapshot.seats).find(
        ([, seat]) => seat?.player.playerId === auth.player.playerId
      )?.[0] as PlayerColor | undefined)
    : null;

  const isMultiplayerParticipant = !!playerSeat;

  const multiplayerYourTurn =
    multiplayerSnapshot?.status === "active" &&
    !!playerSeat &&
    multiplayerSnapshot.state.currentTurn === playerSeat;

  const multiplayerWaitingOnOpponent =
    multiplayerSnapshot?.status === "active" &&
    !!playerSeat &&
    multiplayerSnapshot.state.currentTurn !== playerSeat;

  const multiplayerStatusTitle = !multiplayerSnapshot
    ? "Game"
    : winner
      ? `${formatPlayerColor(winner)} wins`
      : multiplayerSnapshot.status === "waiting"
        ? "Waiting for player two"
        : multiplayerYourTurn
          ? "Your move"
          : "Waiting for opponent";

  const [copyFeedbackKey, setCopyFeedbackKey] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  async function handleCopyGameId() {
    if (!multiplayerSnapshot) return;
    try {
      await navigator.clipboard.writeText(multiplayerSnapshot.gameId);
      setCopyFeedback("Copied!");
      setCopyFeedbackKey("game-id");
      toast.success(`Copied Game ID ${multiplayerSnapshot.gameId}`);
      setTimeout(() => {
        setCopyFeedback(null);
        setCopyFeedbackKey(null);
      }, 2000);
    } catch { toast.error("Failed to copy"); }
  }

  async function handleCopyGameLink() {
    if (!multiplayerSnapshot) return;
    try {
      const url = `${window.location.origin}/game/${multiplayerSnapshot.gameId}`;
      await navigator.clipboard.writeText(url);
      setCopyFeedback("Link copied!");
      setCopyFeedbackKey("share-link");
      toast.success("Copied Share Link");
      setTimeout(() => {
        setCopyFeedback(null);
        setCopyFeedbackKey(null);
      }, 2000);
    } catch { toast.error("Failed to copy"); }
  }

  const multiplayerJumpTargets = multiplayerSelection && multiplayerSnapshot
    ? getJumpTargets(multiplayerSnapshot.state, multiplayerSelection, multiplayerSnapshot.state.currentTurn)
    : [];

  const handleBoardClick = (position: any) => {
    if (!multiplayerSnapshot || !playerSeat || !multiplayerYourTurn) return;

    const state = multiplayerSnapshot.state;
    const tile = state.positions[position.y][position.x];
    const activeOrigin = multiplayerSelection;
    const jumpTargets = activeOrigin
      ? getJumpTargets(state, activeOrigin, state.currentTurn)
      : [];

    if (activeOrigin && arePositionsEqual(activeOrigin, position)) {
      if (state.pendingJump.length > 0) {
        sendMultiplayerMessage({ type: "confirm-jump" });
        setMultiplayerSelection(null);
      } else {
        setMultiplayerSelection(null);
      }
      return;
    }

    if (activeOrigin && jumpTargets.some(t => arePositionsEqual(t, position))) {
      sendMultiplayerMessage({ type: "jump-piece", from: activeOrigin, to: position });
      setMultiplayerSelection(position);
      return;
    }

    if (tile === playerSeat) {
      setMultiplayerSelection(position);
      return;
    }

    if (tile === null && !activeOrigin) {
      sendMultiplayerMessage({ type: "place-piece", position });
      setMultiplayerSelection(null);
      return;
    }

    setMultiplayerSelection(null);
  };

  const paperCard =
    "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

  const boardWrapStyle = {
    maxWidth: "min(100%, calc(100dvh - 5rem))",
    aspectRatio: "1/1",
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[18rem] bg-[radial-gradient(circle_at_top,_rgba(255,247,231,0.76),_transparent_58%)]" />

      <Navbar
        mode="multiplayer"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-[104rem] flex-col gap-5 px-4 pb-3 pt-16 sm:px-6 sm:pt-5 lg:px-6 lg:pb-4 xl:pt-2">
        <section className="grid gap-3 xl:gap-1.5 xl:grid-cols-[minmax(0,1fr)_17.75rem] xl:items-start">
          <div className="flex items-center justify-center xl:min-h-[calc(100dvh-1.5rem)]">
            <div className="relative mx-auto w-full" style={boardWrapStyle}>
              {multiplayerSnapshot && (
                <TiaoBoard
                  state={multiplayerSnapshot.state}
                  selectedPiece={multiplayerSelection}
                  jumpTargets={multiplayerJumpTargets}
                  confirmReady={true}
                  onPointClick={handleBoardClick}
                  disabled={!multiplayerYourTurn}
                  onUndoLastJump={() => sendMultiplayerMessage({ type: "undo-pending-jump-step" })}
                />
              )}
              {multiplayerSnapshot?.status === "waiting" && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="flex items-center gap-3 rounded-3xl border border-[#dcc7a2] bg-[#fff7ec]/92 px-5 py-3 text-sm font-semibold text-[#5d4732] shadow-lg backdrop-blur">
                    <HourglassSpinner className="text-[#7b5f3f]" />
                    Waiting For Opponent...
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4 xl:max-h-[calc(100dvh-1.5rem)] xl:overflow-auto">
            <div className="mx-auto w-full xl:mx-0" style={boardWrapStyle}>
              <Card className={cn(paperCard, multiplayerYourTurn && "border-[#b7cb8d] bg-[linear-gradient(180deg,rgba(251,255,243,0.98),rgba(240,248,224,0.96))]")}>
                <CardHeader className="gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <GamePanelBrand />
                      <Badge className="w-fit bg-[#eee3cf] text-[#5f4932] mt-1">
                        Multiplayer
                      </Badge>
                    </div>
                    <div className="flex shrink-0 justify-end">
                      {multiplayerSnapshot && connectionState !== "connected" ? (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className="flex items-center gap-2 rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-3 py-2 text-sm font-semibold text-[#5d4732] shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur"
                        >
                          <HourglassSpinner className="text-[#7b5f3f]" />
                          {connectionState === "connecting" ? "Connecting" : "Reconnecting"}
                        </motion.div>
                      ) : multiplayerYourTurn ? (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className="flex items-center rounded-full border border-[#b8cc8f] bg-[#f7fce9]/96 px-3 py-2 text-sm font-semibold text-[#56703f] shadow-[0_16px_28px_-22px_rgba(63,92,32,0.42)] backdrop-blur"
                        >
                          Your move
                        </motion.div>
                      ) : multiplayerWaitingOnOpponent ? (
                        <motion.div
                          initial={{ opacity: 0, y: -8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className="flex items-center gap-2 rounded-full border border-[#d8c29c] bg-[#fff8ee]/96 px-3 py-2 text-sm font-semibold text-[#5d4732] shadow-[0_16px_28px_-22px_rgba(67,45,24,0.5)] backdrop-blur"
                        >
                          <HourglassSpinner className="text-[#7b5f3f]" />
                          Waiting For Opponent To Move
                        </motion.div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-4 border-t border-black/5 pt-4">
                    <div className="space-y-1">
                      <CardTitle className="font-display text-2xl text-[#2b1e14]">
                        {multiplayerSnapshot?.status === "active" ? "Live match" : multiplayerStatusTitle}
                      </CardTitle>
                    </div>
                    {multiplayerSnapshot && (
                      <div className="flex items-center gap-2">
                        <RoomCodeCopyPill gameId={multiplayerSnapshot.gameId} copied={copyFeedbackKey === "game-id" && !!copyFeedback} onCopy={handleCopyGameId} />
                        <ShareLinkCopyPill copied={copyFeedbackKey === "share-link" && !!copyFeedback} onCopy={handleCopyGameLink} />
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {multiplayerSnapshot ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <AnimatedScoreTile label="Black" value={multiplayerSnapshot.state.score.black} pulseKey={0} className="rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#39312b,#14100d)] p-4 text-[#f9f2e8]" labelClassName="text-xs uppercase tracking-wider" />
                        <AnimatedScoreTile label="White" value={multiplayerSnapshot.state.score.white} pulseKey={0} className="rounded-3xl border border-[#d3c3ad] bg-[linear-gradient(180deg,#fffef8,#efe4d1)] p-4 text-[#2b1e14]" labelClassName="text-xs uppercase tracking-wider" />
                      </div>

                      {multiplayerSnapshot.status === "waiting" ? (
                        <div className="space-y-2">
                          {Array.from({ length: 2 }, (_, index) => {
                            const slot = multiplayerSnapshot.players[index] ?? null;
                            return (
                              <div key={`lobby-player-${index}`} className="flex items-center justify-between gap-3 rounded-3xl border border-[#d8c29c] bg-[#fffaf1] px-4 py-3">
                                <div className="flex items-center gap-3">
                                  {slot ? <PlayerOverviewAvatar player={slot.player} /> : <EmptySeatAvatar />}
                                  <div>
                                    <p className="text-sm font-semibold text-[#2b1e14]">{index === 0 ? "Lobby host" : "Second player"}</p>
                                    <p className="text-sm text-[#7a6656]">{slot ? formatPlayerName(slot.player, auth?.player.playerId) : "Waiting to join"}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {!slot && auth?.player.kind === "account" && isMultiplayerParticipant && (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      className="text-xs border-[#dcc7a2]"
                                      onClick={() => setInviteDialogOpen(true)}
                                    >
                                      Invite a Friend
                                    </Button>
                                  )}
                                  <Badge className={cn(slot?.online ? "bg-[#eef2e8] text-[#43513f]" : "bg-[#f2e8d9] text-[#6e5b48]")}>
                                    {slot?.online ? "Online" : "Offline"}
                                  </Badge>
                                </div>
                              </div>
                            );
                          })}
                          <p className="mt-4 text-xs leading-relaxed text-[#7a6656]">
                            Share the Game ID or use the share link above to invite a friend.
                            White still starts. The colors are assigned randomly the
                            moment player two joins the lobby.
                          </p>
                        </div>
                      ) : (
                        <div className="grid gap-2">
                          {(["white", "black"] as PlayerColor[]).map((color) => {
                            const seat = multiplayerSnapshot.seats[color];
                            const isYourSeat = seat?.player.playerId === auth?.player.playerId;
                            const isCurrentTurn = multiplayerSnapshot.state.currentTurn === color;
                            const isAccount = auth?.player.kind === "account";
                            const opponentId = seat?.player.playerId;

                            // Determine friend relationship for non-self seats
                            const isFriend = !isYourSeat && opponentId
                              ? liveSocialOverview.friends.some(f => f.playerId === opponentId)
                              : false;
                            const hasPendingOutgoing = !isYourSeat && opponentId
                              ? liveSocialOverview.outgoingFriendRequests.some(f => f.playerId === opponentId)
                              : false;
                            const hasPendingIncoming = !isYourSeat && opponentId
                              ? liveSocialOverview.incomingFriendRequests.some(f => f.playerId === opponentId)
                              : false;
                            const canBefriend = isAccount && !isYourSeat && seat && seat.player.kind === "account" && !isFriend && !hasPendingOutgoing && !hasPendingIncoming;

                            return (
                              <div key={color} className={cn("flex items-center justify-between gap-3 rounded-3xl border px-4 py-3", isCurrentTurn ? "border-[#b8cc8f] bg-[#f7fce9]" : "border-[#d8c29c] bg-[#fffaf1]")}>
                                <div className="flex items-center gap-3">
                                  {seat ? <PlayerOverviewAvatar player={seat.player} /> : <EmptySeatAvatar />}
                                  <div>
                                    <p className="text-sm font-semibold capitalize text-[#2b1e14]">{color}</p>
                                    <p className="text-sm text-[#7a6656]">{seat ? formatPlayerName(seat.player, auth?.player.playerId) : "Empty"}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {canBefriend && (
                                    <button
                                      type="button"
                                      title={`Send friend request to ${seat.player.displayName}`}
                                      className="flex h-7 w-7 items-center justify-center rounded-full border border-[#d0bb94] bg-[#fff8ee] text-[#7b6550] transition-colors hover:bg-[#f4e8d2] hover:text-[#3a2818]"
                                      onClick={() => social.handleSendFriendRequest(seat.player.playerId)}
                                      disabled={social.socialActionBusyKey === `friend-send:${seat.player.playerId}`}
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                        <path d="M11 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM2.046 15.253c-.058.468.172.92.57 1.175A9.953 9.953 0 0 0 8 18c1.982 0 3.83-.578 5.384-1.573.398-.254.628-.707.57-1.175a6.001 6.001 0 0 0-11.908 0ZM15.75 6.5a.75.75 0 0 0-1.5 0v2h-2a.75.75 0 0 0 0 1.5h2v2a.75.75 0 0 0 1.5 0v-2h2a.75.75 0 0 0 0-1.5h-2v-2Z" />
                                      </svg>
                                    </button>
                                  )}
                                  {!isYourSeat && hasPendingOutgoing && (
                                    <Badge variant="outline" className="text-[#8d7760] text-xs">Pending</Badge>
                                  )}
                                  {!isYourSeat && isFriend && (
                                    <Badge variant="outline" className="text-[#43513f] text-xs">Friend</Badge>
                                  )}
                                  {isYourSeat && (
                                    <Badge className="bg-[#eee3cf] text-[#5f4932]">
                                      You
                                    </Badge>
                                  )}
                                  {seat && (
                                    <Badge
                                      className={cn(
                                        seat.online
                                          ? "bg-[#eef2e8] text-[#43513f]"
                                          : "bg-[#f2e8d9] text-[#6e5b48]"
                                      )}
                                    >
                                      {seat.online ? "Online" : "Offline"}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {multiplayerSnapshot.state.pendingJump.length > 0 && multiplayerYourTurn && (
                        <div className="grid gap-2">
                          <Button variant="outline" onClick={() => sendMultiplayerMessage({ type: "undo-pending-jump-step" })}>Undo jump</Button>
                          <Button className="w-full" onClick={() => sendMultiplayerMessage({ type: "confirm-jump" })}>Confirm jump</Button>
                        </div>
                      )}

                      {winner && (
                        <div className="grid gap-2 border-t border-[#dbc6a2] pt-4">
                          {multiplayerSnapshot.rematch?.requestedBy.includes(playerSeat as PlayerColor) ? (
                            <div className="space-y-2">
                              <p className="text-center text-sm font-medium text-[#56703f]">
                                Rematch requested. Waiting for opponent...
                              </p>
                              {(multiplayerSnapshot.rematch?.requestedBy ?? []).some(color => color !== playerSeat) && (
                                <p className="text-center text-xs text-[#6e5b48]">
                                  Your opponent also wants a rematch! It should start any second.
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                variant="secondary"
                                onClick={() => sendMultiplayerMessage({ type: "request-rematch" })}
                              >
                                {multiplayerSnapshot.rematch?.requestedBy.length ? "Accept Rematch" : "Rematch"}
                              </Button>
                              {(multiplayerSnapshot.rematch?.requestedBy ?? []).some(color => color !== playerSeat) ? (
                                <Button
                                  variant="outline"
                                  onClick={() => sendMultiplayerMessage({ type: "decline-rematch" })}
                                >
                                  Decline
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  onClick={() => navigate("/")}
                                >
                                  Leave
                                </Button>
                              )}
                            </div>
                          )}
                          <Button variant="ghost" onClick={() => navigate("/")}>Back to lobby</Button>
                        </div>
                      )}

                      {multiplayerSnapshot.players.length > 2 && (
                        <div className="space-y-2 border-t border-black/5 pt-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]">Spectators</p>
                          <div className="flex flex-wrap gap-2">
                            {multiplayerSnapshot.players.slice(2).map(slot => (
                              <div key={slot.player.playerId} title={slot.player.displayName}>
                                <PlayerOverviewAvatar player={slot.player} className="h-6 w-6" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : multiplayerBusy ? (
                    <div className="flex flex-col items-center py-12 gap-3">
                      <HourglassSpinner className="h-8 w-8 text-[#a6824d]" />
                      <p className="text-sm text-[#6e5b48]">Loading match...</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>

      <Dialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        title="Invite a Friend"
        description="Choose a friend to invite to this game."
      >
        <div className="space-y-2 max-h-[20rem] overflow-y-auto">
          {liveSocialOverview.friends.length === 0 ? (
            <p className="text-center text-sm text-[#6e5b48] py-6">
              No friends yet. Add friends from the Friends page.
            </p>
          ) : (
            liveSocialOverview.friends.map((friend) => {
              const alreadyInRoom = multiplayerSnapshot?.players.some(
                (slot) => slot.player.playerId === friend.playerId,
              );
              const alreadyInvited = liveSocialOverview.outgoingInvitations.some(
                (inv) => inv.recipient.playerId === friend.playerId && inv.gameId === gameId,
              );
              return (
                <div
                  key={friend.playerId}
                  className="flex items-center justify-between rounded-2xl border border-[#d8c29c] bg-[#fffaf1] px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <PlayerOverviewAvatar player={friend} />
                    <span className="text-sm font-semibold text-[#2b1e14]">{friend.displayName}</span>
                    <Badge className={cn(
                      "text-xs",
                      friend.online ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500",
                    )}>
                      {friend.online ? "Online" : "Offline"}
                    </Badge>
                  </div>
                  {alreadyInRoom ? (
                    <Badge variant="outline" className="text-xs text-[#43513f]">In game</Badge>
                  ) : alreadyInvited ? (
                    <Badge variant="outline" className="text-xs text-[#8d7760]">Invited</Badge>
                  ) : (
                    <Button
                      size="sm"
                      className="text-xs"
                      onClick={() => handleInviteFriend(friend.playerId)}
                      disabled={inviteBusy === friend.playerId}
                    >
                      {inviteBusy === friend.playerId ? "Sending..." : "Invite"}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Dialog>
    </div>
  );
}
