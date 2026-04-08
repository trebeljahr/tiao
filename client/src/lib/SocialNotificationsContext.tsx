import React from "react";
import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { AuthResponse, SocialOverview } from "@shared";
import { EMPTY_SOCIAL_OVERVIEW } from "@shared";
import {
  getSocialOverview,
  acceptFriendRequest,
  declineFriendRequest,
  declineGameInvitation,
  requestRematchRest,
  declineRematchRest,
} from "./api";
import { toastError } from "./errors";
import { useLobbyMessage } from "./LobbySocketContext";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { translatePlayerColor } from "@/components/game/GameShared";
import { AchievementIcon } from "@/components/AchievementIcon";
import { TIER_STYLES } from "@/components/AchievementCard";
import { getAchievementById, type AchievementTier } from "@shared";

// ---------------------------------------------------------------------------
// sessionStorage helpers — track which notification IDs have been toasted so
// we show them on fresh login but skip them on page refresh.
// ---------------------------------------------------------------------------

const TOASTED_KEY_PREFIX = "tiao:toasted-notifs:";
const ACKED_KEY_PREFIX = "tiao:acked-notifs:";

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

// Acknowledged-notification IDs: the user has seen these (e.g. by clicking
// the red notification bubble in Navbar, which scrolls to the relevant
// section). Stored keys are `invitation:{invId}`, `rematch:{gameId}`, and
// `friend-request:{playerId}`. Used to drive "unacknowledged count" badges
// so the bubble clears after view but reappears when a new, not-yet-seen
// item arrives.
function getAckedIds(playerId: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(`${ACKED_KEY_PREFIX}${playerId}`);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function persistAckedIds(playerId: string, ids: Set<string>): void {
  try {
    sessionStorage.setItem(`${ACKED_KEY_PREFIX}${playerId}`, JSON.stringify([...ids]));
  } catch {
    /* best-effort */
  }
}

function clearAckedIds(playerId: string): void {
  try {
    sessionStorage.removeItem(`${ACKED_KEY_PREFIX}${playerId}`);
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type SocialNotificationsContextValue = {
  pendingFriendRequestCount: number;
  unacknowledgedFriendRequestCount: number;
  incomingInvitationCount: number;
  incomingRematchCount: number;
  unacknowledgedInvitationCount: number;
  unacknowledgedRematchCount: number;
  acknowledgeInvitations: () => void;
  acknowledgeFriendRequests: () => void;
  refreshNotifications: () => void;
};

const SocialNotificationsContext = createContext<SocialNotificationsContextValue>({
  pendingFriendRequestCount: 0,
  unacknowledgedFriendRequestCount: 0,
  incomingInvitationCount: 0,
  incomingRematchCount: 0,
  unacknowledgedInvitationCount: 0,
  unacknowledgedRematchCount: 0,
  acknowledgeInvitations: () => {},
  acknowledgeFriendRequests: () => {},
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
  const tAchievements = useTranslations("achievements");
  const tAchievementText = useTranslations("achievements.text");
  const router = useRouter();
  const [overview, setOverview] = useState<SocialOverview>(EMPTY_SOCIAL_OVERVIEW);
  const prevRequestIdsRef = useRef<Set<string>>(new Set());
  const prevInvitationIdsRef = useRef<Set<string>>(new Set());
  const initialFetchDoneRef = useRef(false);
  const playerIdRef = useRef<string | null>(null);

  // Track incoming rematch game IDs for the badge count
  const [incomingRematchGameIds, setIncomingRematchGameIds] = useState<Set<string>>(new Set());

  // Acknowledged notification IDs. Seeded from sessionStorage whenever the
  // signed-in player changes, so a page refresh keeps the bubble clear for
  // items the user already saw this session.
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());

  // ---------------------------------------------------------------------------
  // Toast helpers (shared between initial fetch and WebSocket updates)
  // ---------------------------------------------------------------------------

  const showFriendRequestToast = useCallback(
    (req: SocialOverview["incomingFriendRequests"][number]) => {
      const reqPlayerId = req.playerId;
      const reqName = req.displayName || "Someone";
      const toastId = `friend-request:${reqPlayerId}`;
      toast(
        <div className="min-w-0 cursor-pointer" onClick={() => toast.dismiss(toastId)}>
          <PlayerIdentityRow
            player={req}
            linkToProfile={false}
            avatarClassName="h-6 w-6 shrink-0"
            friendVariant="light"
            nameClassName="text-sm font-medium"
          />
        </div>,
        {
          id: toastId,
          description: "sent you a friend request",
          duration: Infinity,
          dismissible: true,

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

  // Build a "(13×13, 5+3, first to 10, playing as White)" suffix shared
  // between game-invitation and rematch toasts so the recipient sees the
  // exact settings the new game will use.
  const buildGameDetailsSuffix = useCallback(
    (settings: {
      boardSize?: number | null;
      timeControl?: { initialMs: number; incrementMs: number } | null;
      scoreToWin?: number | null;
      assignedColor?: "white" | "black" | null;
    }): string => {
      const details: string[] = [];
      const board = settings.boardSize ?? 19;
      details.push(`${board}×${board}`);
      if (settings.timeControl) {
        const mins = Math.round(settings.timeControl.initialMs / 60_000);
        const inc = Math.round(settings.timeControl.incrementMs / 1_000);
        details.push(inc > 0 ? `${mins}+${inc}` : `${mins}min`);
      } else {
        details.push("Unlimited");
      }
      const score = settings.scoreToWin ?? 10;
      details.push(`first to ${score}`);
      if (settings.assignedColor) {
        const colorName = translatePlayerColor(settings.assignedColor, tGame);
        if (colorName) details.push(tCommon("wouldPlayAs", { color: colorName }));
      }
      return ` (${details.join(", ")})`;
    },
    [tGame, tCommon],
  );

  const showGameInvitationToast = useCallback(
    (inv: SocialOverview["incomingInvitations"][number], onFetch: () => void) => {
      const invGameId = inv.gameId;
      const invId = inv.id;
      const sender = inv.sender;
      const senderName = (typeof sender === "object" ? sender?.displayName : null) || "Someone";

      const suffix = buildGameDetailsSuffix({
        boardSize: inv.boardSize,
        timeControl: inv.timeControl,
        scoreToWin: inv.scoreToWin,
        assignedColor: inv.assignedColor,
      });

      const toastId = `game-invitation:${invId}`;
      toast(
        <div className="min-w-0 cursor-pointer" onClick={() => toast.dismiss(toastId)}>
          <PlayerIdentityRow
            player={typeof sender === "object" ? sender : { displayName: senderName }}
            linkToProfile={false}
            avatarClassName="h-6 w-6 shrink-0"
            friendVariant="light"
            nameClassName="text-sm font-medium"
          />
        </div>,
        {
          id: toastId,
          description: `invited you to a game${suffix}`,
          duration: Infinity,
          dismissible: true,

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
    [buildGameDetailsSuffix],
  );

  // ---------------------------------------------------------------------------
  // Initial fetch — shows toasts for pending items not yet in sessionStorage
  // ---------------------------------------------------------------------------

  const fetchOverview = useCallback(async () => {
    if (!auth || auth.player.kind !== "account") {
      const prevPlayerId = playerIdRef.current;
      if (prevPlayerId) {
        clearToastedIds(prevPlayerId);
        clearAckedIds(prevPlayerId);
      }
      setOverview(EMPTY_SOCIAL_OVERVIEW);
      prevRequestIdsRef.current.clear();
      prevInvitationIdsRef.current.clear();
      initialFetchDoneRef.current = false;
      playerIdRef.current = null;
      setIncomingRematchGameIds(new Set());
      setAcknowledgedIds(new Set());
      return;
    }

    const playerId = auth.player.playerId;
    // Hydrate acknowledged IDs when we first see this player in this session.
    if (playerIdRef.current !== playerId) {
      setAcknowledgedIds(getAckedIds(playerId));
    }
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
      const rematchGameId = summary.gameId as string;
      // The rematch will be played with the same settings as the finished
      // game, so reuse the invite-toast format to show board / time / score.
      // Rematch seats flip server-side, so the accepter's colour IS known:
      // it's the opposite of their seat in the finished game.
      const nextColor: "white" | "black" | null = summary.yourSeat
        ? summary.yourSeat === "white"
          ? "black"
          : "white"
        : null;
      const suffix = buildGameDetailsSuffix({
        boardSize: summary.boardSize,
        timeControl: summary.timeControl,
        scoreToWin: summary.scoreToWin,
        assignedColor: nextColor,
      });
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
          id: `rematch-${rematchGameId}`,
          description: `${t("rematchToastDesc")}${suffix}`,
          duration: 15000,
          action: {
            label: tCommon("accept"),
            onClick: () => {
              void (async () => {
                try {
                  const { newGameId } = await requestRematchRest(rematchGameId);
                  window.location.assign(`/game/${newGameId}`);
                } catch (e) {
                  // Surfaces REMATCH_EXPIRED ("Your opponent cancelled the
                  // rematch request — can't join rematch.") and any other
                  // server-side errors via the existing error toast.
                  toastError(e);
                }
              })();
            },
          },
          cancel: {
            label: tCommon("decline"),
            onClick: () => {
              void declineRematchRest(rematchGameId).catch(toastError);
            },
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

    // Server now ships only the id/tier/secret; we resolve localized text
    // client-side so the broadcast payload stays locale-agnostic.
    const achievement = payload.achievement as
      | { id: string; tier: AchievementTier; secret: boolean }
      | undefined;
    if (!achievement) return;

    const def = getAchievementById(achievement.id);
    const nameKey = `${achievement.id}_name`;
    const descKey = `${achievement.id}_desc`;
    const typedTextT = tAchievementText as unknown as {
      has: (key: string) => boolean;
      (key: string): string;
    };
    const name = typedTextT.has(nameKey) ? typedTextT(nameKey) : (def?.name ?? achievement.id);
    const description = typedTextT.has(descKey) ? typedTextT(descKey) : (def?.description ?? "");

    const tier = TIER_STYLES[achievement.tier];

    toast(
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${tier.bg} ${tier.glow}`}
        >
          <AchievementIcon
            id={achievement.id}
            tier={achievement.tier}
            unlocked
            className={`h-5 w-5 ${tier.icon}`}
          />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#2b1e14]">
            {achievement.secret
              ? tAchievements("secretUnlockedToast")
              : tAchievements("unlockedToast")}
          </p>
          <p className="truncate text-xs text-[#5a4632]">{name}</p>
        </div>
      </div>,
      {
        id: `achievement-${achievement.id}`,
        description,
        duration: Infinity,
        dismissible: true,
        action: {
          label: tAchievements("toastView"),
          onClick: () => {
            toast.dismiss(`achievement-${achievement.id}`);
            router.push("/achievements");
          },
        },
        cancel: {
          label: tAchievements("toastDismiss"),
          onClick: () => {
            toast.dismiss(`achievement-${achievement.id}`);
          },
        },
      },
    );
  });

  const pendingFriendRequestCount = overview.incomingFriendRequests.length;
  const incomingInvitationCount = overview.incomingInvitations.length;
  const incomingRematchCount = incomingRematchGameIds.size;

  // Prune acknowledgedIds whenever the current set of incoming items changes,
  // so IDs that no longer exist (invitation accepted/declined elsewhere, game
  // archived, friend request acted on, etc.) stop taking up space and don't
  // mask a future re-add.
  useEffect(() => {
    const playerId = playerIdRef.current;
    if (!playerId) return;
    setAcknowledgedIds((prev) => {
      if (prev.size === 0) return prev;
      const liveIds = new Set<string>();
      for (const inv of overview.incomingInvitations) liveIds.add(`invitation:${inv.id}`);
      for (const gameId of incomingRematchGameIds) liveIds.add(`rematch:${gameId}`);
      for (const req of overview.incomingFriendRequests)
        liveIds.add(`friend-request:${req.playerId}`);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (liveIds.has(id)) next.add(id);
        else changed = true;
      }
      if (!changed) return prev;
      persistAckedIds(playerId, next);
      return next;
    });
  }, [overview.incomingInvitations, overview.incomingFriendRequests, incomingRematchGameIds]);

  const unacknowledgedInvitationCount = overview.incomingInvitations.reduce(
    (count, inv) => (acknowledgedIds.has(`invitation:${inv.id}`) ? count : count + 1),
    0,
  );
  let unacknowledgedRematchCount = 0;
  for (const gameId of incomingRematchGameIds) {
    if (!acknowledgedIds.has(`rematch:${gameId}`)) unacknowledgedRematchCount += 1;
  }
  const unacknowledgedFriendRequestCount = overview.incomingFriendRequests.reduce(
    (count, req) => (acknowledgedIds.has(`friend-request:${req.playerId}`) ? count : count + 1),
    0,
  );

  const acknowledgeInvitations = useCallback(() => {
    const playerId = playerIdRef.current;
    if (!playerId) return;
    setAcknowledgedIds((prev) => {
      const next = new Set(prev);
      for (const inv of overview.incomingInvitations) next.add(`invitation:${inv.id}`);
      for (const gameId of incomingRematchGameIds) next.add(`rematch:${gameId}`);
      if (next.size === prev.size) return prev;
      persistAckedIds(playerId, next);
      return next;
    });
  }, [overview.incomingInvitations, incomingRematchGameIds]);

  const acknowledgeFriendRequests = useCallback(() => {
    const playerId = playerIdRef.current;
    if (!playerId) return;
    setAcknowledgedIds((prev) => {
      const next = new Set(prev);
      for (const req of overview.incomingFriendRequests) next.add(`friend-request:${req.playerId}`);
      if (next.size === prev.size) return prev;
      persistAckedIds(playerId, next);
      return next;
    });
  }, [overview.incomingFriendRequests]);

  return (
    <SocialNotificationsContext.Provider
      value={{
        pendingFriendRequestCount,
        unacknowledgedFriendRequestCount,
        incomingInvitationCount,
        incomingRematchCount,
        unacknowledgedInvitationCount,
        unacknowledgedRematchCount,
        acknowledgeInvitations,
        acknowledgeFriendRequests,
        refreshNotifications: fetchOverview,
      }}
    >
      {children}
    </SocialNotificationsContext.Provider>
  );
}
