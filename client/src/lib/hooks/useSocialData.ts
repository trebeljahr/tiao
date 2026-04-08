import { useState, useCallback, useEffect, useRef } from "react";
import {
  AuthResponse,
  SocialOverview,
  SocialSearchResult,
  SocialPlayerSummary,
  EMPTY_SOCIAL_OVERVIEW,
} from "@shared";
import {
  getSocialOverview,
  searchPlayers,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  removeFriend,
  sendGameInvitation,
  revokeGameInvitation,
  declineGameInvitation,
} from "../api";
import { toastError } from "../errors";
import { fetchWithRetry } from "../fetchWithRetry";
import { useSocialNotifications } from "../SocialNotificationsContext";
import { useLobbyMessage } from "../LobbySocketContext";

/** Shape of the player-identity-update broadcast sent from gameService. */
type PlayerIdentityUpdatePayload = {
  type: "player-identity-update";
  playerId: string;
  displayName?: string;
  profilePicture?: string;
  rating?: number;
  activeBadges?: string[];
};

function patchSocialSummary(
  summary: SocialPlayerSummary,
  patch: PlayerIdentityUpdatePayload,
): SocialPlayerSummary {
  if (summary.playerId !== patch.playerId) return summary;
  return {
    ...summary,
    displayName: patch.displayName ?? summary.displayName,
    profilePicture: patch.profilePicture ?? summary.profilePicture,
    rating: patch.rating ?? summary.rating,
    activeBadges: patch.activeBadges ?? summary.activeBadges,
  };
}

export function useSocialData(auth: AuthResponse | null, canToastIncomingInvites: boolean) {
  const { refreshNotifications } = useSocialNotifications();
  const [socialOverview, setSocialOverview] = useState<SocialOverview>(EMPTY_SOCIAL_OVERVIEW);
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialLoaded, setSocialLoaded] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [friendSearchResults, setFriendSearchResults] = useState<SocialSearchResult[]>([]);
  const [friendSearchBusy, setFriendSearchBusy] = useState(false);
  const [socialActionBusyKey, setSocialActionBusyKey] = useState<string | null>(null);

  const socialInvitationIdsRef = useRef<Set<string>>(new Set());
  const socialInvitationsHydratedRef = useRef(false);

  // Reset loaded state when the player identity changes (e.g. after logout)
  const prevPlayerIdRef = useRef(auth?.player.playerId ?? null);
  useEffect(() => {
    const currentPlayerId = auth?.player.playerId ?? null;
    if (currentPlayerId !== prevPlayerIdRef.current) {
      prevPlayerIdRef.current = currentPlayerId;
      setSocialOverview(EMPTY_SOCIAL_OVERVIEW);
      setSocialLoaded(false);
      setSocialLoading(false);
      setFriendSearchQuery("");
      setFriendSearchResults([]);
      socialInvitationIdsRef.current.clear();
      socialInvitationsHydratedRef.current = false;
    }
  }, [auth?.player.playerId]);

  const applySocialOverview = useCallback(
    (nextOverview: SocialOverview, allowInviteToast: boolean) => {
      const incomingIds = new Set(
        nextOverview.incomingInvitations.map((invitation) => invitation.id),
      );

      if (allowInviteToast && socialInvitationsHydratedRef.current && canToastIncomingInvites) {
        // Toast is handled by SocialNotificationsContext with action buttons
      }

      socialInvitationIdsRef.current = incomingIds;
      socialInvitationsHydratedRef.current = true;
      setSocialOverview(nextOverview);
      setSocialLoaded(true);
    },
    [canToastIncomingInvites],
  );

  const refreshSocialOverview = useCallback(
    async (options: { silent?: boolean; allowInviteToast?: boolean } = {}) => {
      if (!auth || auth.player.kind !== "account") {
        setSocialOverview(EMPTY_SOCIAL_OVERVIEW);
        setSocialLoaded(false);
        setSocialLoading(false);
        socialInvitationIdsRef.current.clear();
        socialInvitationsHydratedRef.current = false;
        return;
      }

      setSocialLoading(true);

      try {
        const response = options.silent
          ? await getSocialOverview()
          : await fetchWithRetry(() => getSocialOverview(), "social");
        applySocialOverview(response.overview, options.allowInviteToast ?? false);
        refreshNotifications();
      } catch {
        // Mark as loaded even on error to prevent infinite retry loops
        setSocialLoaded(true);
      } finally {
        setSocialLoading(false);
      }
    },
    [auth, applySocialOverview, refreshNotifications],
  );

  const runFriendSearch = useCallback(async () => {
    if (!auth || auth.player.kind !== "account") {
      return;
    }

    if (!friendSearchQuery.trim()) {
      setFriendSearchResults([]);
      return;
    }

    setFriendSearchBusy(true);

    try {
      const response = await searchPlayers(friendSearchQuery.trim());
      setFriendSearchResults(response.results);
    } catch (error) {
      toastError(error);
    } finally {
      setFriendSearchBusy(false);
    }
  }, [auth, friendSearchQuery]);

  const handleSendFriendRequest = useCallback(
    async (accountId: string) => {
      if (!auth || auth.player.kind !== "account") {
        return;
      }

      setSocialActionBusyKey(`friend-send:${accountId}`);

      try {
        await sendFriendRequest(accountId);
        await refreshSocialOverview({ silent: true });
        await runFriendSearch();
      } catch (error) {
        toastError(error);
      } finally {
        setSocialActionBusyKey(null);
      }
    },
    [auth, refreshSocialOverview, runFriendSearch],
  );

  const handleAcceptFriendRequest = useCallback(
    async (accountId: string) => {
      if (!auth || auth.player.kind !== "account") {
        return;
      }

      setSocialActionBusyKey(`friend-accept:${accountId}`);

      try {
        await acceptFriendRequest(accountId);
        await refreshSocialOverview({ silent: true });
        await runFriendSearch();
      } catch (error) {
        toastError(error);
      } finally {
        setSocialActionBusyKey(null);
      }
    },
    [auth, refreshSocialOverview, runFriendSearch],
  );

  const handleDeclineFriendRequest = useCallback(
    async (accountId: string) => {
      if (!auth || auth.player.kind !== "account") {
        return;
      }

      setSocialActionBusyKey(`friend-decline:${accountId}`);

      try {
        await declineFriendRequest(accountId);
        await refreshSocialOverview({ silent: true });
        await runFriendSearch();
      } catch (error) {
        toastError(error);
      } finally {
        setSocialActionBusyKey(null);
      }
    },
    [auth, refreshSocialOverview, runFriendSearch],
  );

  const handleCancelFriendRequest = useCallback(
    async (accountId: string) => {
      if (!auth || auth.player.kind !== "account") {
        return;
      }

      setSocialActionBusyKey(`friend-cancel:${accountId}`);

      try {
        await cancelFriendRequest(accountId);
        await refreshSocialOverview({ silent: true });
        await runFriendSearch();
      } catch (error) {
        toastError(error);
      } finally {
        setSocialActionBusyKey(null);
      }
    },
    [auth, refreshSocialOverview, runFriendSearch],
  );

  const handleRemoveFriend = useCallback(
    async (accountId: string) => {
      if (!auth || auth.player.kind !== "account") return;
      setSocialActionBusyKey(`friend-remove:${accountId}`);
      try {
        await removeFriend(accountId);
        await refreshSocialOverview({ silent: true });
        await runFriendSearch();
      } catch (error) {
        toastError(error);
      } finally {
        setSocialActionBusyKey(null);
      }
    },
    [auth, refreshSocialOverview, runFriendSearch],
  );

  const handleSendGameInvitation = useCallback(
    async (gameId: string, recipientId: string, expiresInMinutes: number) => {
      if (!auth || auth.player.kind !== "account") {
        return;
      }

      setSocialActionBusyKey(`invite-send:${recipientId}`);

      try {
        await sendGameInvitation({
          gameId,
          recipientId,
          expiresInMinutes,
        });
        await refreshSocialOverview({ silent: true });
      } catch (error) {
        toastError(error);
      } finally {
        setSocialActionBusyKey(null);
      }
    },
    [auth, refreshSocialOverview],
  );

  const handleRevokeGameInvitation = useCallback(
    async (invitationId: string) => {
      if (!auth || auth.player.kind !== "account") {
        return;
      }

      setSocialActionBusyKey(`invite-revoke:${invitationId}`);

      try {
        await revokeGameInvitation(invitationId);
        await refreshSocialOverview({ silent: true });
      } catch (error) {
        toastError(error);
      } finally {
        setSocialActionBusyKey(null);
      }
    },
    [auth, refreshSocialOverview],
  );

  const handleDeclineGameInvitation = useCallback(
    async (invitationId: string) => {
      if (!auth || auth.player.kind !== "account") {
        return;
      }

      setSocialActionBusyKey(`invite-decline:${invitationId}`);

      try {
        await declineGameInvitation(invitationId);
        await refreshSocialOverview({ silent: true });
      } catch (error) {
        toastError(error);
      } finally {
        setSocialActionBusyKey(null);
      }
    },
    [auth, refreshSocialOverview],
  );

  // Initial fetch — only runs once per auth identity (guarded by socialLoaded)
  const refreshSocialRef = useRef(refreshSocialOverview);
  refreshSocialRef.current = refreshSocialOverview;
  useEffect(() => {
    if (auth?.player.kind === "account" && !socialLoaded && !socialLoading) {
      void refreshSocialRef.current({ allowInviteToast: true });
    }
  }, [auth, socialLoaded, socialLoading]);

  // Patch identity updates (badge equip, display-name change, etc.) into the
  // cached overview so friends / pending requests / invitations update live.
  useLobbyMessage((payload) => {
    if (payload.type !== "player-identity-update") return;
    const patch = payload as PlayerIdentityUpdatePayload;
    if (!patch.playerId) return;

    setSocialOverview((prev) => {
      let touched = false;
      const mapSummaries = (list: SocialPlayerSummary[]) =>
        list.map((summary) => {
          if (summary.playerId !== patch.playerId) return summary;
          touched = true;
          return patchSocialSummary(summary, patch);
        });

      const nextFriends = mapSummaries(prev.friends);
      const nextIncoming = mapSummaries(prev.incomingFriendRequests);
      const nextOutgoing = mapSummaries(prev.outgoingFriendRequests);
      const nextIncomingInvites = prev.incomingInvitations.map((inv) => {
        const sender = patchSocialSummary(inv.sender, patch);
        const recipient = patchSocialSummary(inv.recipient, patch);
        if (sender === inv.sender && recipient === inv.recipient) return inv;
        touched = true;
        return { ...inv, sender, recipient };
      });
      const nextOutgoingInvites = prev.outgoingInvitations.map((inv) => {
        const sender = patchSocialSummary(inv.sender, patch);
        const recipient = patchSocialSummary(inv.recipient, patch);
        if (sender === inv.sender && recipient === inv.recipient) return inv;
        touched = true;
        return { ...inv, sender, recipient };
      });

      if (!touched) return prev;
      return {
        ...prev,
        friends: nextFriends,
        incomingFriendRequests: nextIncoming,
        outgoingFriendRequests: nextOutgoing,
        incomingInvitations: nextIncomingInvites,
        outgoingInvitations: nextOutgoingInvites,
      };
    });
  });

  return {
    socialOverview,
    socialLoading,
    socialLoaded,
    friendSearchQuery,
    setFriendSearchQuery,
    friendSearchResults,
    friendSearchBusy,
    socialActionBusyKey,
    refreshSocialOverview,
    runFriendSearch,
    handleSendFriendRequest,
    handleAcceptFriendRequest,
    handleDeclineFriendRequest,
    handleCancelFriendRequest,
    handleRemoveFriend,
    handleSendGameInvitation,
    handleRevokeGameInvitation,
    handleDeclineGameInvitation,
  };
}
