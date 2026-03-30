# Shared skeleton loading for auth-dependent pages

## Context

The `LoadingScreen` splash was removed from `AppShell`, so pages now render immediately. But pages that require an authenticated account (FriendsPage, GamesPage) have this pattern:

```tsx
if (!auth || auth.player.kind !== "account") {
  return null; // or redirect
}
```

During the `authLoading` phase, `auth` is `null`, so these pages would flash-redirect logged-in users to `/` before auth finishes. We need a shared way to show loading skeletons while auth bootstraps.

## Approach: `RequireAccount` wrapper component

Create a single `RequireAccount` component that encapsulates the auth-loading + account-check + redirect logic. Pages wrap their content with it and get skeletons for free.

```tsx
// Usage in any account-only page:
function GamesPage() {
  return <RequireAccount>{(auth) => <GamesPageContent auth={auth} />}</RequireAccount>;
}
```

The component handles three states:

1. **`authLoading`**: Show a page-level skeleton (Navbar placeholder + pulsing content area)
2. **`auth.player.kind !== "account"`**: Redirect to `/` (guest/anonymous)
3. **Ready**: Render children with guaranteed non-null account auth

### Skeleton design

A generic `PageSkeleton` that matches the app's warm paper aesthetic — sticky navbar placeholder bar + centered pulsing card skeleton. Reuses the same `animate-pulse` + `bg-[#e8dcc8]` style from the lobby skeletons.

## Files to modify

1. **`client/src/components/RequireAccount.tsx`** (new) — shared wrapper component with `PageSkeleton`
2. **`client/src/views/FriendsPage.tsx`** — replace manual auth guard + redirect with `RequireAccount`
3. **`client/src/views/GamesPage.tsx`** — same
4. **`client/src/views/LobbyPage.tsx`** — extract `LobbySectionSkeleton` to shared location (optional, can stay inline)

Pages that DON'T need changes:

- **MatchmakingPage** — already handles `authLoading` inline with its own spinner
- **ProfilePage** — guards are inside functions, not page-level redirects
- **TournamentPage, LocalGamePage, ComputerGamePage, PublicProfilePage** — use `auth?.` optional chaining, no redirect risk
- **AdminBadgesPage** — has its own forbidden UI

## Verification

- Start dev server, navigate to `/friends` and `/games` while logged out — should briefly show skeleton then redirect
- Navigate while logged in — should show skeleton briefly then content
- Lobby still works as before (immediate render, skeleton for auth sections)
