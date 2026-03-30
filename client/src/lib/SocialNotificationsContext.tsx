import React from "react";
import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
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

type SocialNotificationsContextValue = {
  pendingFriendRequestCount: number;
  incomingInvitationCount: number;
  refreshNotifications: () => void;
};

const SocialNotificationsContext = createContext<SocialNotificationsContextValue>({
  pendingFriendRequestCount: 0,
  incomingInvitationCount: 0,
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
  const [overview, setOverview] = useState<SocialOverview>(EMPTY_SOCIAL_OVERVIEW);
  const prevRequestIdsRef = useRef<Set<string>>(new Set());
  const prevInvitationIdsRef = useRef<Set<string>>(new Set());
  const hydratedRef = useRef(false);

  const fetchOverview = useCallback(async () => {
    if (!auth || auth.player.kind !== "account") {
      setOverview(EMPTY_SOCIAL_OVERVIEW);
      prevRequestIdsRef.current.clear();
      hydratedRef.current = false;
      return;
    }

    try {
      const res = await getSocialOverview();
      const nextOverview = res.overview;
      prevRequestIdsRef.current = new Set(
        nextOverview.incomingFriendRequests.map((r) => r.playerId),
      );
      prevInvitationIdsRef.current = new Set(nextOverview.incomingInvitations.map((inv) => inv.id));
      hydratedRef.current = true;
      setOverview(nextOverview);
    } catch {
      // Silently fail - notifications are best-effort
    }
  }, [auth]);

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

    // Show toast for new friend requests
    if (hydratedRef.current) {
      const nextRequestIds = new Set(nextOverview.incomingFriendRequests.map((r) => r.playerId));

      // Dismiss toasts for friend requests that are no longer pending
      for (const prevId of prevRequestIdsRef.current) {
        if (!nextRequestIds.has(prevId)) {
          toast.dismiss(`friend-request:${prevId}`);
        }
      }

      for (const req of nextOverview.incomingFriendRequests) {
        if (!prevRequestIdsRef.current.has(req.playerId)) {
          const reqPlayerId = req.playerId;
          const reqName = req.displayName || "Someone";
          toast(
            <div className="flex items-center gap-2">
              <PlayerIdentityRow
                player={req}
                linkToProfile={false}
                avatarClassName="h-6 w-6"
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
        }
      }
    }

    // Show toast for new game invitations
    if (hydratedRef.current) {
      const nextInvitationIds = new Set(nextOverview.incomingInvitations.map((inv) => inv.id));

      // Dismiss toasts for game invitations that are no longer pending
      for (const prevId of prevInvitationIdsRef.current) {
        if (!nextInvitationIds.has(prevId)) {
          toast.dismiss(`game-invitation:${prevId}`);
        }
      }

      for (const inv of nextOverview.incomingInvitations) {
        if (!prevInvitationIdsRef.current.has(inv.id)) {
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
          const suffix = ` (${details.join(", ")})`;

          toast(
            <div className="flex items-center gap-2">
              <PlayerIdentityRow
                player={typeof sender === "object" ? sender : { displayName: senderName }}
                linkToProfile={false}
                avatarClassName="h-6 w-6"
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
                  void declineGameInvitation(invId).then(() => fetchOverview());
                },
              },
            },
          );
        }
      }
    }

    prevRequestIdsRef.current = new Set(nextOverview.incomingFriendRequests.map((r) => r.playerId));
    prevInvitationIdsRef.current = new Set(nextOverview.incomingInvitations.map((inv) => inv.id));
    hydratedRef.current = true;
    setOverview(nextOverview);
  });

  const pendingFriendRequestCount = overview.incomingFriendRequests.length;
  const incomingInvitationCount = overview.incomingInvitations.length;

  return (
    <SocialNotificationsContext.Provider
      value={{
        pendingFriendRequestCount,
        incomingInvitationCount,
        refreshNotifications: fetchOverview,
      }}
    >
      {children}
    </SocialNotificationsContext.Provider>
  );
}
