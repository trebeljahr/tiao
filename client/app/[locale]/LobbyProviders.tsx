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
 * Mounted by AppShell on application routes. Public landing and rules
 * pages omit this chain to avoid opening a lobby connection.
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
