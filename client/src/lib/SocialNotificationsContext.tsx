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
      for (const req of nextOverview.incomingFriendRequests) {
        if (!prevRequestIdsRef.current.has(req.playerId)) {
          const reqPlayerId = req.playerId;
          const reqName = req.displayName;
          toast(`${reqName} sent you a friend request`, {
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
          });
        }
      }
    }

    // Show toast for new game invitations
    if (hydratedRef.current) {
      for (const inv of nextOverview.incomingInvitations) {
        if (!prevInvitationIdsRef.current.has(inv.id)) {
          const invGameId = inv.gameId;
          const invId = inv.id;
          const senderName = inv.sender.displayName;
          toast(`${senderName} invited you to a game`, {
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
          });
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
