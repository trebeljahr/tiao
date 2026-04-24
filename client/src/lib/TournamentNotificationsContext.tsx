"use client";

import type { AuthResponse, PendingTournamentMatch } from "@shared";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLobbyMessage } from "./LobbySocketContext";
import { getMyPendingTournamentMatches } from "./api";

/**
 * Global "your tournament match is ready" notification layer. Server is
 * the source of truth: on mount / auth-change / lobby-message we fetch
 * `getMyPendingTournamentMatches()` and show one sticky sonner toast per
 * pending match.
 *
 * Why no sessionStorage dedupe: the server decides whether a match is
 * still pending. After a page reload we re-fetch and sonner re-opens
 * the same-id toast. When the player actually joins the game (or the
 * match resolves server-side), the next fetch drops it from the pending
 * list and we dismiss the toast.
 *
 * Pattern mirrors `SocialNotificationsContext` — see that file for the
 * same approach with friend requests and rematches.
 */
export function TournamentNotificationsProvider({
  auth,
  children,
}: {
  auth: AuthResponse | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const t = useTranslations("tournament");
  const tCommon = useTranslations("common");

  // matchId -> toast-id we currently have open for it. Used to diff the
  // latest server state against what we're showing and dismiss toasts
  // whose matches are no longer pending.
  const activeToastsRef = useRef<Map<string, string>>(new Map());

  const fireToast = useCallback(
    (match: PendingTournamentMatch) => {
      const toastId = `tournament-ready:${match.matchId}`;
      activeToastsRef.current.set(match.matchId, toastId);

      const description = match.opponentDisplayName
        ? t("matchReadyToastVs", { opponent: match.opponentDisplayName })
        : match.tournamentName;

      toast(t("matchReadyToast"), {
        id: toastId,
        description,
        duration: Number.POSITIVE_INFINITY,
        dismissible: true,
        action: {
          label: tCommon("play"),
          onClick: () => {
            toast.dismiss(toastId);
            router.push(`/game/${match.roomId}`);
          },
        },
      });
    },
    [router, t, tCommon],
  );

  const refresh = useCallback(async () => {
    if (!auth || auth.player.kind !== "account") {
      // Not signed in — clear any stale toasts.
      for (const toastId of activeToastsRef.current.values()) {
        toast.dismiss(toastId);
      }
      activeToastsRef.current.clear();
      return;
    }

    try {
      const { matches } = await getMyPendingTournamentMatches();
      const nextIds = new Set(matches.map((m) => m.matchId));

      // Drop toasts whose matches are no longer pending.
      for (const [matchId, toastId] of activeToastsRef.current) {
        if (!nextIds.has(matchId)) {
          toast.dismiss(toastId);
          activeToastsRef.current.delete(matchId);
        }
      }

      // Fire toasts for matches we haven't surfaced yet. Skip matches we
      // already have a toast for — sonner would reuse the id anyway, but
      // re-firing pushes the toast back to the top every time which is
      // annoying during a reload cycle.
      for (const match of matches) {
        if (activeToastsRef.current.has(match.matchId)) continue;
        // Also skip if the user is currently ON the game page for this
        // match — they're clearly already there, no need for a toast.
        if (
          typeof window !== "undefined" &&
          window.location.pathname.startsWith(`/game/${match.roomId}`)
        ) {
          continue;
        }
        fireToast(match);
      }
    } catch {
      // Non-critical — fail silently and try again next event.
    }
  }, [auth, fireToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useLobbyMessage(
    useCallback(
      (payload) => {
        if (!auth || auth.player.kind !== "account") return;
        if (
          payload.type === "tournament-match-ready" ||
          payload.type === "tournament-update" ||
          payload.type === "tournament-round-complete"
        ) {
          void refresh();
        }
        // If a tournament game finishes for the player, refresh too —
        // that match should drop off the pending list.
        if (payload.type === "game-update") {
          const summary = (payload.summary ?? {}) as Record<string, unknown>;
          if (summary.roomType === "tournament") {
            void refresh();
          }
        }
      },
      [auth, refresh],
    ),
  );

  return <>{children}</>;
}
