import React, { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { SocialOverview, SocialPlayerSummary, GameInvitationSummary } from "@shared";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { cn } from "@/lib/utils";

type InviteFriendsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gameId: string | undefined;
  socialOverview: SocialOverview;
  playerIds: string[];
  onInvite: (friendId: string) => void;
  onRevoke: (invitationId: string) => void;
  inviteBusy: string | null;
  revokeBusy: string | null;
};

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={cn("h-4 w-4", className)}
    >
      <path
        fillRule="evenodd"
        d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function EnvelopeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={cn("h-4 w-4", className)}
    >
      <path d="M3 4a2 2 0 0 0-2 2v1.161l8.441 4.221a1.25 1.25 0 0 0 1.118 0L19 7.162V6a2 2 0 0 0-2-2H3Z" />
      <path d="m19 8.839-7.77 3.885a2.75 2.75 0 0 1-2.46 0L1 8.839V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.839Z" />
    </svg>
  );
}

function UndoIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={cn("h-3.5 w-3.5", className)}
    >
      <path
        fillRule="evenodd"
        d="M7.793 2.232a.75.75 0 0 1-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 0 1 0 10.75H10.75a.75.75 0 0 1 0-1.5h2.875a3.875 3.875 0 0 0 0-7.75H3.622l4.146 3.957a.75.75 0 0 1-1.036 1.085l-5.5-5.25a.75.75 0 0 1 0-1.085l5.5-5.25a.75.75 0 0 1 1.06.025Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function UserGroupIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={cn("h-5 w-5", className)}
    >
      <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.468-.172.92-.57 1.174A9.953 9.953 0 0 1 7 18a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z" />
    </svg>
  );
}

export function InviteFriendsModal({
  open,
  onOpenChange,
  gameId,
  socialOverview,
  playerIds,
  onInvite,
  onRevoke,
  inviteBusy,
  revokeBusy,
}: InviteFriendsModalProps) {
  const t = useTranslations("game");
  const [search, setSearch] = useState("");

  // Sort friends: online first, then alphabetically
  const sortedFriends = useMemo(() => {
    const friends = [...socialOverview.friends];
    friends.sort((a, b) => {
      const aOnline = a.online ? 1 : 0;
      const bOnline = b.online ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return (a.displayName ?? "").localeCompare(b.displayName ?? "");
    });
    return friends;
  }, [socialOverview.friends]);

  // Filter by search query
  const filteredFriends = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sortedFriends;
    return sortedFriends.filter((f) => (f.displayName ?? "").toLowerCase().includes(query));
  }, [sortedFriends, search]);

  // Helper to find the outgoing invitation for a friend in this game
  function findInvitation(friendId: string): GameInvitationSummary | undefined {
    return socialOverview.outgoingInvitations.find(
      (inv) => inv.recipient.playerId === friendId && inv.gameId === gameId,
    );
  }

  function renderFriendAction(friend: SocialPlayerSummary) {
    const alreadyInRoom = playerIds.includes(friend.playerId);
    const invitation = findInvitation(friend.playerId);

    if (alreadyInRoom) {
      return (
        <Badge variant="outline" className="shrink-0 text-xs text-[#43513f]">
          {t("inGame")}
        </Badge>
      );
    }

    if (invitation) {
      return (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5 border-[#dcc7a2] text-xs text-[#8d7760] hover:border-red-300 hover:bg-red-50 hover:text-red-600"
          onClick={() => onRevoke(invitation.id)}
          disabled={revokeBusy === invitation.id}
        >
          <UndoIcon className="h-3 w-3" />
          {revokeBusy === invitation.id ? t("revoking") : t("revoke")}
        </Button>
      );
    }

    return (
      <Button
        size="sm"
        className="shrink-0 gap-1.5 text-xs"
        onClick={() => onInvite(friend.playerId)}
        disabled={inviteBusy === friend.playerId}
      >
        <EnvelopeIcon className="h-3.5 w-3.5" />
        {inviteBusy === friend.playerId ? t("sending") : t("invite")}
      </Button>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSearch("");
        onOpenChange(next);
      }}
      title={t("inviteFriend")}
      description={t("inviteFriendDesc")}
    >
      <div className="space-y-3">
        {/* Search bar */}
        {socialOverview.friends.length > 3 && (
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8d7760]" />
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchFriends")}
              className="pl-9"
              autoFocus
            />
          </div>
        )}

        {/* Friends list */}
        <div className="max-h-[20rem] space-y-2 overflow-y-auto">
          {socialOverview.friends.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <UserGroupIcon className="text-[#b7a48e]" />
              <p className="text-center text-sm text-[#6e5b48]">{t("noFriendsYet")}</p>
            </div>
          ) : filteredFriends.length === 0 ? (
            <p className="py-4 text-center text-sm text-[#8d7760]">{t("noMatchingFriends")}</p>
          ) : (
            filteredFriends.map((friend) => (
              <div
                key={friend.playerId}
                className="flex items-center justify-between rounded-2xl border border-[#d8c29c] bg-[#fffaf1] px-4 py-3"
              >
                <PlayerIdentityRow
                  player={friend}
                  online={friend.online}
                  nameClassName="text-sm font-semibold text-[#2b1e14]"
                  className="min-w-0 gap-3"
                />
                {renderFriendAction(friend)}
              </div>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
