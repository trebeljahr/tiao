import React from "react";
import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { AuthResponse, SocialOverview } from "@shared";
import { EMPTY_SOCIAL_OVERVIEW } from "@shared";
import {
  getSocialOverview,
  acceptFriendRequest,
  declineFriendRequest,
  declineGameInvitation,
} from "./api";
import { toastError } from "./errors";
import { useLobbyMessage } from "./LobbySocketContext";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { translatePlayerColor } from "@/components/game/GameShared";

// ---------------------------------------------------------------------------
// sessionStorage helpers — track which notification IDs have been toasted so
// we show them on fresh login but skip them on page refresh.
// ---------------------------------------------------------------------------

const TOASTED_KEY_PREFIX = "tiao:toasted-notifs:";

function getToastedIds(playerId: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(`${TOASTED_KEY_PREFIX}${playerId}`);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function markToasted(playerId: string, ids: string[]): void {
  if (ids.length === 0) return;
  try {
    const existing = getToastedIds(playerId);
    for (const id of ids) existing.add(id);
    sessionStorage.setItem(`${TOASTED_KEY_PREFIX}${playerId}`, JSON.stringify([...existing]));
  } catch {
    /* sessionStorage may be full or unavailable */
  }
}

function clearToastedIds(playerId: string): void {
  try {
    sessionStorage.removeItem(`${TOASTED_KEY_PREFIX}${playerId}`);
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type SocialNotificationsContextValue = {
  pendingFriendRequestCount: number;
  incomingInvitationCount: number;
  incomingRematchCount: number;
  refreshNotifications: () => void;
};

const SocialNotificationsContext = createContext<SocialNotificationsContextValue>({
  pendingFriendRequestCount: 0,
  incomingInvitationCount: 0,
  incomingRematchCount: 0,
  refreshNotifications: () => {},
});

export function useSocialNotifications() {
  return useContext(SocialNotificationsContext);
}

export function SocialNotificationsProvider({
  auth,
  children,
}: {
  auth: AuthResponse | null;
  children: React.ReactNode;
}) {
  const t = useTranslations("lobby");
  const tGame = useTranslations("game");
  const tCommon = useTranslations("common");
  const [overview, setOverview] = useState<SocialOverview>(EMPTY_SOCIAL_OVERVIEW);
  const prevRequestIdsRef = useRef<Set<string>>(new Set());
  const prevInvitationIdsRef = useRef<Set<string>>(new Set());
  const initialFetchDoneRef = useRef(false);
  const playerIdRef = useRef<string | null>(null);

  // Track incoming rematch game IDs for the badge count
  const [incomingRematchGameIds, setIncomingRematchGameIds] = useState<Set<string>>(new Set());

  // ---------------------------------------------------------------------------
  // Toast helpers (shared between initial fetch and WebSocket updates)
  // ---------------------------------------------------------------------------

  const showFriendRequestToast = useCallback(
    (req: SocialOverview["incomingFriendRequests"][number]) => {
      const reqPlayerId = req.playerId;
      const reqName = req.displayName || "Someone";
      toast(
        <div className="min-w-0">
          <PlayerIdentityRow
            player={req}
            linkToProfile={false}
            avatarClassName="h-6 w-6 shrink-0"
            friendVariant="light"
            nameClassName="text-sm font-medium"
          />
        </div>,
        {
          id: `friend-request:${reqPlayerId}`,
          description: "sent you a friend request",
          duration: 15000,

          action: {
            label: "Accept",
            onClick: () => {
              void (async () => {
                try {
                  await acceptFriendRequest(reqPlayerId);
                  toast.success(`You are now friends with ${reqName}`);
                } catch (e) {
                  toastError(e);
                }
              })();
            },
          },
          cancel: {
            label: "Decline",
            onClick: () => {
              void (async () => {
                try {
                  await declineFriendRequest(reqPlayerId);
                } catch (e) {
                  toastError(e);
                }
              })();
            },
          },
        },
      );
    },
    [],
  );

  const showGameInvitationToast = useCallback(
    (inv: SocialOverview["incomingInvitations"][number], onFetch: () => void) => {
      const invGameId = inv.gameId;
      const invId = inv.id;
      const sender = inv.sender;
      const senderName = (typeof sender === "object" ? sender?.displayName : null) || "Someone";

      // Build contextual toast message with game details
      const details: string[] = [];
      const board = inv.boardSize ?? 19;
      details.push(`${board}×${board}`);
      if (inv.timeControl) {
        const mins = Math.round(inv.timeControl.initialMs / 60_000);
        const inc = Math.round(inv.timeControl.incrementMs / 1_000);
        details.push(inc > 0 ? `${mins}+${inc}` : `${mins}min`);
      } else {
        details.push("Unlimited");
      }
      const score = inv.scoreToWin ?? 10;
      details.push(`first to ${score}`);
      if (inv.assignedColor) {
        const colorName = translatePlayerColor(inv.assignedColor, tGame);
        if (colorName) details.push(tCommon("playingAs", { color: colorName }));
      }
      const suffix = ` (${details.join(", ")})`;

      toast(
        <div className="min-w-0">
          <PlayerIdentityRow
            player={typeof sender === "object" ? sender : { displayName: senderName }}
            linkToProfile={false}
            avatarClassName="h-6 w-6 shrink-0"
            friendVariant="light"
            nameClassName="text-sm font-medium"
          />
        </div>,
        {
          id: `game-invitation:${invId}`,
          description: `invited you to a game${suffix}`,
          duration: 15000,

          action: {
            label: "Join",
            onClick: () => {
              window.location.assign(`/game/${invGameId}`);
            },
          },
          cancel: {
            label: "Decline",
            onClick: () => {
              void declineGameInvitation(invId).then(onFetch);
            },
          },
        },
      );
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Initial fetch — shows toasts for pending items not yet in sessionStorage
  // ---------------------------------------------------------------------------

  const fetchOverview = useCallback(async () => {
    if (!auth || auth.player.kind !== "account") {
      const prevPlayerId = playerIdRef.current;
      if (prevPlayerId) clearToastedIds(prevPlayerId);
      setOverview(EMPTY_SOCIAL_OVERVIEW);
      prevRequestIdsRef.current.clear();
      prevInvitationIdsRef.current.clear();
      initialFetchDoneRef.current = false;
      playerIdRef.current = null;
      setIncomingRematchGameIds(new Set());
      return;
    }

    const playerId = auth.player.playerId;
    playerIdRef.current = playerId;

    try {
      const res = await getSocialOverview();
      const nextOverview = res.overview;

      // Show toasts for pending notifications not yet seen in this session
      const toasted = getToastedIds(playerId);
      const newlyToasted: string[] = [];

      for (const req of nextOverview.incomingFriendRequests) {
        const key = `friend-request:${req.playerId}`;
        if (!toasted.has(key)) {
          showFriendRequestToast(req);
          newlyToasted.push(key);
        }
      }

      for (const inv of nextOverview.incomingInvitations) {
        const key = `game-invitation:${inv.id}`;
        if (!toasted.has(key)) {
          showGameInvitationToast(inv, fetchOverview);
          newlyToasted.push(key);
        }
      }

      markToasted(playerId, newlyToasted);

      prevRequestIdsRef.current = new Set(
        nextOverview.incomingFriendRequests.map((r) => r.playerId),
      );
      prevInvitationIdsRef.current = new Set(nextOverview.incomingInvitations.map((inv) => inv.id));
      initialFetchDoneRef.current = true;
      setOverview(nextOverview);
    } catch {
      // Silently fail - notifications are best-effort
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, showFriendRequestToast, showGameInvitationToast]);

  // Initial fetch
  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  // Subscribe to lobby socket for social-update messages
  useLobbyMessage((payload) => {
    if (payload.type !== "social-update") return;

    // If no overview is included, re-fetch from the server
    if (!payload.overview) {
      void fetchOverview();
      return;
    }

    const nextOverview = payload.overview as SocialOverview;
    const playerId = playerIdRef.current;

    // Show toast for new friend requests (only after initial fetch is done)
    if (initialFetchDoneRef.current) {
      const nextRequestIds = new Set(nextOverview.incomingFriendRequests.map((r) => r.playerId));

      // Dismiss toasts for friend requests that are no longer pending
      for (const prevId of prevRequestIdsRef.current) {
        if (!nextRequestIds.has(prevId)) {
          toast.dismiss(`friend-request:${prevId}`);
        }
      }

      const newlyToasted: string[] = [];
      for (const req of nextOverview.incomingFriendRequests) {
        if (!prevRequestIdsRef.current.has(req.playerId)) {
          showFriendRequestToast(req);
          newlyToasted.push(`friend-request:${req.playerId}`);
        }
      }
      if (playerId) markToasted(playerId, newlyToasted);
    }

    // Show toast for new game invitations
    if (initialFetchDoneRef.current) {
      const nextInvitationIds = new Set(nextOverview.incomingInvitations.map((inv) => inv.id));

      // Dismiss toasts for game invitations that are no longer pending
      for (const prevId of prevInvitationIdsRef.current) {
        if (!nextInvitationIds.has(prevId)) {
          toast.dismiss(`game-invitation:${prevId}`);
        }
      }

      const newlyToasted: string[] = [];
      for (const inv of nextOverview.incomingInvitations) {
        if (!prevInvitationIdsRef.current.has(inv.id)) {
          showGameInvitationToast(inv, fetchOverview);
          newlyToasted.push(`game-invitation:${inv.id}`);
        }
      }
      if (playerId) markToasted(playerId, newlyToasted);
    }

    prevRequestIdsRef.current = new Set(nextOverview.incomingFriendRequests.map((r) => r.playerId));
    prevInvitationIdsRef.current = new Set(nextOverview.incomingInvitations.map((inv) => inv.id));
    initialFetchDoneRef.current = true;
    setOverview(nextOverview);
  });

  // Global rematch toast — fires on every page so the opponent sees the
  // notification even after navigating away from the game or lobby.
  useLobbyMessage((payload) => {
    if (payload.type !== "game-update") return;

    const summary = payload.summary as Record<string, any> | undefined;
    if (!summary) return;

    const playerId = playerIdRef.current;

    // Update incoming rematch tracking for badge count
    setIncomingRematchGameIds((prev) => {
      const isIncomingRematch =
        summary.status === "finished" &&
        summary.rematch?.requestedBy?.length &&
        summary.yourSeat &&
        !summary.rematch.requestedBy.includes(summary.yourSeat);

      if (isIncomingRematch) {
        if (prev.has(summary.gameId)) return prev;
        const next = new Set(prev);
        next.add(summary.gameId);
        return next;
      } else {
        if (!prev.has(summary.gameId)) return prev;
        const next = new Set(prev);
        next.delete(summary.gameId);
        return next;
      }
    });

    // Don't show the toast when the user is already on the game page —
    // MultiplayerGamePage has its own rematch UI with accept/decline actions.
    const inGame = typeof window !== "undefined" && window.location.pathname.startsWith("/game/");
    if (inGame) return;

    if (
      summary.status === "finished" &&
      summary.rematch?.requestedBy?.length &&
      summary.yourSeat &&
      !summary.rematch.requestedBy.includes(summary.yourSeat)
    ) {
      // Check sessionStorage to avoid re-toasting on page refresh
      const toastKey = `rematch:${summary.gameId}`;
      if (playerId) {
        const toasted = getToastedIds(playerId);
        if (toasted.has(toastKey)) return;
        markToasted(playerId, [toastKey]);
      }

      const opponentSeat = summary.yourSeat === "white" ? "black" : "white";
      const opponentPlayer = summary.seats?.[opponentSeat]?.player;
      toast(
        <div className="min-w-0">
          <PlayerIdentityRow
            player={opponentPlayer ?? { displayName: "your opponent" }}
            linkToProfile={false}
            avatarClassName="h-6 w-6 shrink-0"
            friendVariant="light"
            nameClassName="text-sm font-medium"
          />
        </div>,
        {
          id: `rematch-${summary.gameId}`,
          description: t("rematchToastDesc"),
          action: {
            label: t("viewGame"),
            onClick: () => window.location.assign(`/game/${summary.gameId}`),
          },
        },
      );
    } else if (playerId) {
      // Rematch was cancelled/declined — remove from sessionStorage so a future
      // rematch on the same game can toast again
      const toasted = getToastedIds(playerId);
      const toastKey = `rematch:${summary.gameId}`;
      if (toasted.has(toastKey)) {
        toasted.delete(toastKey);
        try {
          sessionStorage.setItem(`${TOASTED_KEY_PREFIX}${playerId}`, JSON.stringify([...toasted]));
        } catch {
          /* best-effort */
        }
      }
      // Dismiss any visible rematch toast for this game
      toast.dismiss(`rematch-${summary.gameId}`);
    }
  });

  // Achievement unlock notification
  useLobbyMessage((payload) => {
    if (payload.type !== "achievement-unlocked") return;

    const achievement = payload.achievement as
      | {
          id: string;
          name: string;
          description: string;
          tier: string;
          secret: boolean;
        }
      | undefined;
    if (!achievement) return;

    toast(
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-yellow-400/30 to-amber-600/20">
          <svg
            className="h-5 w-5 text-yellow-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 9V2h12v7a6 6 0 01-12 0zM6 4H4a1 1 0 00-1 1v1a4 4 0 004 4M18 4h2a1 1 0 011 1v1a4 4 0 01-4 4M9 21h6M12 15v6"
            />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#2b1e14] truncate">
            {achievement.secret ? "Secret Achievement!" : "Achievement Unlocked!"}
          </p>
          <p className="text-xs text-[#5a4632] truncate">{achievement.name}</p>
        </div>
      </div>,
      {
        id: `achievement-${achievement.id}`,
        description: achievement.description,
        duration: 8000,
        action: {
          label: "View",
          onClick: () => window.location.assign("/achievements"),
        },
      },
    );
  });

  const pendingFriendRequestCount = overview.incomingFriendRequests.length;
  const incomingInvitationCount = overview.incomingInvitations.length;
  const incomingRematchCount = incomingRematchGameIds.size;

  return (
    <SocialNotificationsContext.Provider
      value={{
        pendingFriendRequestCount,
        incomingInvitationCount,
        incomingRematchCount,
        refreshNotifications: fetchOverview,
      }}
    >
      {children}
    </SocialNotificationsContext.Provider>
  );
}
