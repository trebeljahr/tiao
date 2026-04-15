"use client";

/**
 * Lobby-scoped provider chain.
 *
 * Holds the three real-time context providers that depend on an open
 * WebSocket to /api/ws/lobby:
 *
 *   - LobbySocketProvider        — the WS connection itself
 *   - SocialNotificationsProvider — friend requests, profile updates
 *   - TournamentNotificationsProvider — tournament invites/updates
 *
 * Extracted from providers.tsx so it can live in its own module and
 * (in a future refactor) be scoped to only the routes that actually
 * need it. Today it's still mounted universally from providers.tsx
 * via AppShell, but isolating the module boundary makes it easier to
 * reason about the compile graph and lays the groundwork for a route-
 * group split if we want to strip these providers from non-lobby
 * routes entirely.
 */

import { useAuth } from "@/lib/AuthContext";
import { LobbySocketProvider } from "@/lib/LobbySocketContext";
import { SocialNotificationsProvider } from "@/lib/SocialNotificationsContext";
import { TournamentNotificationsProvider } from "@/lib/TournamentNotificationsContext";

export function LobbyProviders({ children }: { children: React.ReactNode }) {
  const { auth } = useAuth();
  return (
    <LobbySocketProvider auth={auth}>
      <SocialNotificationsProvider auth={auth}>
        <TournamentNotificationsProvider auth={auth}>{children}</TournamentNotificationsProvider>
      </SocialNotificationsProvider>
    </LobbySocketProvider>
  );
}
