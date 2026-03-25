import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { toast } from "sonner";
import type { AuthResponse, SocialOverview } from "@shared";
import { EMPTY_SOCIAL_OVERVIEW } from "@shared";
import {
  getSocialOverview,
  acceptFriendRequest,
  declineFriendRequest,
  buildWebSocketUrl,
} from "./api";
import { toastError } from "./errors";

type SocialNotificationsContextValue = {
  pendingFriendRequestCount: number;
  refreshNotifications: () => void;
};

const SocialNotificationsContext =
  createContext<SocialNotificationsContextValue>({
    pendingFriendRequestCount: 0,
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
  const [overview, setOverview] = useState<SocialOverview>(
    EMPTY_SOCIAL_OVERVIEW,
  );
  const prevRequestIdsRef = useRef<Set<string>>(new Set());
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

  // Socket connection for real-time updates
  useEffect(() => {
    if (!auth || auth.player.kind !== "account") return;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    function connect() {
      const url = new URL(buildWebSocketUrl("lobby"));
      url.pathname = "/api/ws/lobby";
      url.searchParams.delete("gameId");

      socket = new WebSocket(url.toString());

      socket.onmessage = (event) => {
        let payload: any;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        if (payload.type === "social-update" && payload.overview) {
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
                          toast.success(
                            `You are now friends with ${reqName}`,
                          );
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

          prevRequestIdsRef.current = new Set(
            nextOverview.incomingFriendRequests.map((r) => r.playerId),
          );
          hydratedRef.current = true;
          setOverview(nextOverview);
        }
      };

      socket.onclose = () => {
        socket = null;
        if (auth && auth.player.kind === "account") {
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      };

      socket.onerror = () => {
        socket?.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [auth]);

  const pendingFriendRequestCount = overview.incomingFriendRequests.length;

  return (
    <SocialNotificationsContext.Provider
      value={{ pendingFriendRequestCount, refreshNotifications: fetchOverview }}
    >
      {children}
    </SocialNotificationsContext.Provider>
  );
}
