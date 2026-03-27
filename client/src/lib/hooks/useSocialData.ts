import { useState, useCallback, useEffect, useRef } from "react";
import {
  AuthResponse,
  SocialOverview,
  SocialSearchResult,
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

export function useSocialData(auth: AuthResponse | null, canToastIncomingInvites: boolean) {
  const [socialOverview, setSocialOverview] = useState<SocialOverview>(
    EMPTY_SOCIAL_OVERVIEW,
  );
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialLoaded, setSocialLoaded] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [friendSearchResults, setFriendSearchResults] = useState<
    SocialSearchResult[]
  >([]);
  const [friendSearchBusy, setFriendSearchBusy] = useState(false);
  const [socialActionBusyKey, setSocialActionBusyKey] = useState<string | null>(
    null,
  );

  const socialInvitationIdsRef = useRef<Set<string>>(new Set());
  const socialInvitationsHydratedRef = useRef(false);

  const applySocialOverview = useCallback(
    (nextOverview: SocialOverview, allowInviteToast: boolean) => {
      const incomingIds = new Set(
        nextOverview.incomingInvitations.map((invitation) => invitation.id),
      );

      if (
        allowInviteToast &&
        socialInvitationsHydratedRef.current &&
        canToastIncomingInvites
      ) {
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
        const response = await getSocialOverview();
        applySocialOverview(response.overview, options.allowInviteToast ?? false);
      } catch (error) {
        if (!options.silent) {
          toastError(error);
        }
      } finally {
        setSocialLoading(false);
      }
    },
    [auth, applySocialOverview],
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

  useEffect(() => {
    if (auth?.player.kind === "account" && !socialLoaded && !socialLoading) {
      void refreshSocialOverview({ allowInviteToast: true });
    }
  }, [auth, socialLoaded, socialLoading, refreshSocialOverview]);

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
