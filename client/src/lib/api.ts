import type {
  AuthResponse,
  FriendActiveGameSummary,
  MultiplayerGameSummary,
  MultiplayerGamesIndex,
  MultiplayerSnapshot,
  PlayerIdentity,
  SocialOverview,
  SocialSearchResult,
  TournamentListItem,
  TournamentSettings,
  TournamentSnapshot,
  TournamentStatus,
  AchievementDefinition,
} from "@shared";

type JsonBody = Record<string, unknown> | undefined;

export type AccountProfile = {
  displayName: string;
  email?: string;
  profilePicture?: string;
  badges?: string[];
  activeBadges?: string[];
  bio?: string;
  rating?: number;
  gamesPlayed?: number;
  ratingPercentile?: number;
  createdAt?: string;
  updatedAt?: string;
  /** Auth providers linked to this account (e.g. "credential", "github", "google") */
  providers?: string[];
};

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function getApiBaseUrl() {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }

  return typeof window !== "undefined" ? window.location.origin : "";
}

export const API_BASE_URL = getApiBaseUrl();

function getWebSocketBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }
  if (process.env.NEXT_PUBLIC_API_PORT && typeof window !== "undefined") {
    return `http://${window.location.hostname}:${process.env.NEXT_PUBLIC_API_PORT}`;
  }
  return typeof window !== "undefined" ? window.location.origin : "";
}

export function buildWebSocketUrl(gameId: string) {
  const url = new URL(getWebSocketBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/ws";
  url.searchParams.set("gameId", gameId);
  return url.toString();
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: JsonBody;
  } = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Make sure the backend is running.");
  }

  const data = (await response.json().catch(() => ({}))) as {
    message?: string;
    code?: string;
  } & T;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.message || "The request could not be completed.",
      data.code,
    );
  }

  return data;
}

async function upload<T>(path: string, formData: FormData): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Make sure the backend is running.");
  }

  const data = (await response.json().catch(() => ({}))) as {
    message?: string;
    code?: string;
  } & T;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.message || "The request could not be completed.",
      data.code,
    );
  }

  return data;
}

/**
 * Custom login endpoint that supports username OR email as identifier.
 * better-auth only accepts email, so our server wrapper resolves usernames.
 */
export function login(identifier: string, password: string) {
  return request<{ player: PlayerIdentity }>("/api/player/login", {
    method: "POST",
    body: {
      identifier,
      password,
    },
  });
}

/**
 * Fetch enriched PlayerIdentity (with game-specific data like badges, rating).
 * Called after better-auth session is established to get the full profile.
 */
export function getPlayerIdentity() {
  return request<{ player: PlayerIdentity }>("/api/player/me");
}

/**
 * Set username for SSO users during onboarding.
 */
export function setUsername(username: string) {
  return request<{ auth: AuthResponse }>("/api/player/set-username", {
    method: "POST",
    body: { username },
  });
}

export function createMultiplayerGame(settings?: {
  boardSize?: number;
  scoreToWin?: number;
  timeControl?: { initialMs: number; incrementMs: number };
  creatorColor?: "white" | "black";
}) {
  return request<{ snapshot: MultiplayerSnapshot }>("/api/games", {
    method: "POST",
    body: settings,
  });
}

export function cancelMultiplayerGame(gameId: string) {
  return request<{ message: string }>(`/api/games/${gameId}`, {
    method: "DELETE",
  });
}

export function cancelRematchRequest(gameId: string) {
  return request<{ message: string }>(`/api/games/${gameId}/cancel-rematch`, {
    method: "POST",
  });
}

export function requestRematchRest(gameId: string) {
  return request<{ newGameId: string }>(`/api/games/${gameId}/request-rematch`, {
    method: "POST",
  });
}

export function declineRematchRest(gameId: string) {
  return request<{ message: string }>(`/api/games/${gameId}/decline-rematch`, {
    method: "POST",
  });
}

export function joinMultiplayerGame(gameId: string) {
  return request<{ snapshot: MultiplayerSnapshot }>(`/api/games/${gameId}/join`, {
    method: "POST",
  });
}

export function accessMultiplayerGame(gameId: string) {
  return request<{ snapshot: MultiplayerSnapshot }>(`/api/games/${gameId}/access`, {
    method: "POST",
  });
}

export function getMultiplayerGame(gameId: string) {
  return request<{ snapshot: MultiplayerSnapshot }>(`/api/games/${gameId}`);
}

export function listMultiplayerGames() {
  return request<{ games: MultiplayerGamesIndex }>("/api/games");
}

// Matchmaking moved to the lobby WebSocket — see `useMatchmakingData` and
// `LobbyClientMessage` in @shared. The REST endpoints were removed because
// they could not detect page-unloads, which left ghost queue entries.

export function getSocialOverview() {
  return request<{ overview: SocialOverview }>("/api/player/social/overview");
}

export function searchPlayers(query: string) {
  return request<{ results: SocialSearchResult[] }>(
    `/api/player/social/search?q=${encodeURIComponent(query)}`,
    {},
  );
}

export function sendFriendRequest(accountId: string) {
  return request<{ message: string }>("/api/player/social/friend-requests", {
    method: "POST",
    body: {
      accountId,
    },
  });
}

export function acceptFriendRequest(accountId: string) {
  return request<{ message: string }>(`/api/player/social/friend-requests/${accountId}/accept`, {
    method: "POST",
  });
}

export function declineFriendRequest(accountId: string) {
  return request<{ message: string }>(`/api/player/social/friend-requests/${accountId}/decline`, {
    method: "POST",
  });
}

export function cancelFriendRequest(accountId: string) {
  return request<{ message: string }>(`/api/player/social/friend-requests/${accountId}/cancel`, {
    method: "POST",
  });
}

export function removeFriend(accountId: string) {
  return request<{ message: string }>(`/api/player/social/friends/${accountId}/remove`, {
    method: "POST",
  });
}

export function getFriendActiveGames(friendId: string) {
  return request<{ games: FriendActiveGameSummary[] }>(
    `/api/player/social/friends/${friendId}/active-games`,
  );
}

export function sendGameInvitation(body: {
  gameId: string;
  recipientId: string;
  expiresInMinutes: number;
}) {
  return request<{ message: string }>("/api/player/social/game-invitations", {
    method: "POST",
    body,
  });
}

export function revokeGameInvitation(invitationId: string) {
  return request<{ message: string }>(
    `/api/player/social/game-invitations/${invitationId}/revoke`,
    {
      method: "POST",
    },
  );
}

export function declineGameInvitation(invitationId: string) {
  return request<{ message: string }>(
    `/api/player/social/game-invitations/${invitationId}/decline`,
    {
      method: "POST",
    },
  );
}

export function markTutorialComplete() {
  return request<{ auth: AuthResponse }>("/api/player/tutorial-complete", {
    method: "POST",
  });
}

export function getAccountProfile() {
  return request<{ profile: AccountProfile }>("/api/player/profile");
}

export type PublicProfile = {
  playerId: string;
  displayName: string;
  profilePicture?: string;
  rating?: number;
  gamesPlayed?: number;
  gamesWon?: number;
  gamesLost?: number;
  ratingPercentile?: number;
  createdAt?: string;
  bio?: string;
  badges?: string[];
  activeBadges?: string[];
  favoriteBoard?: number;
  favoriteTimeControl?: string;
  favoriteScore?: number;
  friendshipStatus?: "none" | "friend" | "outgoing-request" | "incoming-request" | "self";
};

export function getPublicProfile(username: string) {
  return request<{ profile: PublicProfile }>(`/api/player/profile/${encodeURIComponent(username)}`);
}

export function getPlayerMatchHistory(
  username: string,
  options?: { limit?: number; before?: string },
) {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.before) params.set("before", options.before);
  const qs = params.toString();
  return request<{ playerId: string; games: MultiplayerGameSummary[]; hasMore: boolean }>(
    `/api/player/profile/${encodeURIComponent(username)}/games${qs ? `?${qs}` : ""}`,
  );
}

export function updateAccountProfile(body: {
  displayName?: string;
  email?: string;
  password?: string;
  currentPassword?: string;
  bio?: string;
}) {
  return request<{ auth: AuthResponse; profile: AccountProfile }>("/api/player/profile", {
    method: "PUT",
    body,
  });
}

export function uploadAccountProfilePicture(file: File) {
  const formData = new FormData();
  formData.set("profilePicture", file);

  return upload<{ auth: AuthResponse; profile: AccountProfile }>(
    "/api/player/profile-picture",
    formData,
  );
}

export function setAccountPassword(body: {
  password: string;
  email?: string;
  displayName?: string;
}) {
  return request<{ providers: string[] }>("/api/player/set-password", {
    method: "POST",
    body,
  });
}

export function requestEmailChange(body: { newEmail: string; currentPassword: string }) {
  return request<{ status: "sent" }>("/api/player/request-email-change", {
    method: "POST",
    body,
  });
}

export function deleteAccount(displayName: string) {
  return request<{ message: string }>("/api/player/account", {
    method: "DELETE",
    body: { displayName },
  });
}

export function updateActiveBadges(activeBadges: string[]) {
  return request<{ auth: AuthResponse; activeBadges: string[] }>("/api/player/badges/active", {
    method: "PUT",
    body: { activeBadges },
  });
}

// ── Shop API ──

export type ShopCatalogItem = {
  type: "badge" | "theme";
  id: string;
  price: number;
  currency: string;
  owned: boolean;
  recurring?: { interval: "month" | "year" };
};

export type Subscription = {
  subscriptionId: string;
  badgeId: string;
  status: "active" | "past_due" | "canceled";
  currentPeriodEnd: string;
};

export function getShopCatalog() {
  return request<{ catalog: ShopCatalogItem[] }>("/api/shop/catalog");
}

export function createCheckoutSession(itemType: string, itemId: string) {
  return request<{ url: string }>("/api/shop/checkout", {
    method: "POST",
    body: { itemType, itemId },
  });
}

export function getSubscriptions() {
  return request<{ subscriptions: Subscription[] }>("/api/shop/subscriptions");
}

export function cancelSubscription(subscriptionId: string) {
  return request<{ message: string; currentPeriodEnd: string }>("/api/shop/cancel-subscription", {
    method: "POST",
    body: { subscriptionId },
  });
}

// ── Tournament API ──

export function listPublicTournaments(status?: TournamentStatus) {
  const qs = status ? `?status=${status}` : "";
  return request<{ tournaments: TournamentListItem[] }>(`/api/tournaments${qs}`);
}

export function listMyTournaments() {
  return request<{ tournaments: TournamentListItem[] }>("/api/tournaments/my");
}

export function createTournament(body: {
  name: string;
  description?: string;
  settings: TournamentSettings;
}) {
  return request<{ tournament: TournamentSnapshot }>("/api/tournaments", {
    method: "POST",
    body: body as unknown as Record<string, unknown>,
  });
}

export function getTournament(tournamentId: string) {
  return request<{ tournament: TournamentSnapshot }>(`/api/tournaments/${tournamentId}`);
}

export function accessTournament(tournamentId: string, inviteCode: string) {
  return request<{ tournament: TournamentSnapshot }>(`/api/tournaments/${tournamentId}/access`, {
    method: "POST",
    body: { inviteCode },
  });
}

export function registerForTournament(tournamentId: string, inviteCode?: string) {
  return request<{ tournament: TournamentSnapshot }>(`/api/tournaments/${tournamentId}/register`, {
    method: "POST",
    body: inviteCode ? { inviteCode } : undefined,
  });
}

export function unregisterFromTournament(tournamentId: string) {
  return request<{ tournament: TournamentSnapshot }>(
    `/api/tournaments/${tournamentId}/unregister`,
    { method: "POST" },
  );
}

export function startTournament(tournamentId: string) {
  return request<{ tournament: TournamentSnapshot }>(`/api/tournaments/${tournamentId}/start`, {
    method: "POST",
  });
}

export function cancelTournament(tournamentId: string) {
  return request<{ tournament: TournamentSnapshot }>(`/api/tournaments/${tournamentId}/cancel`, {
    method: "POST",
  });
}

export function deleteTournament(tournamentId: string) {
  return request<Record<string, never>>(`/api/tournaments/${tournamentId}`, {
    method: "DELETE",
  });
}

export function updateTournamentSeeding(
  tournamentId: string,
  seeds: { playerId: string; seed: number }[],
) {
  return request<{ tournament: TournamentSnapshot }>(`/api/tournaments/${tournamentId}/seeding`, {
    method: "PUT",
    body: { seeds } as unknown as Record<string, unknown>,
  });
}

export function randomizeTournamentSeeding(tournamentId: string) {
  return request<{ tournament: TournamentSnapshot }>(
    `/api/tournaments/${tournamentId}/seeding/randomize`,
    { method: "POST" },
  );
}

export function setTournamentFeaturedMatch(tournamentId: string, matchId: string | null) {
  return request<{ tournament: TournamentSnapshot }>(
    `/api/tournaments/${tournamentId}/featured-match`,
    {
      method: "PUT",
      body: { matchId },
    },
  );
}

export function forfeitTournamentMatch(tournamentId: string, matchId: string, loserId: string) {
  return request<{ tournament: TournamentSnapshot }>(
    `/api/tournaments/${tournamentId}/matches/${matchId}/forfeit`,
    {
      method: "POST",
      body: { loserId },
    },
  );
}

// ── Admin API ──

export type AdminUserResult = {
  playerId: string;
  displayName: string;
  profilePicture?: string;
  badges: string[];
  activeBadges: string[];
  unlockedThemes: string[];
  achievements: string[];
};

export function adminSearchUsers(query: string) {
  return request<{ users: AdminUserResult[] }>(
    `/api/player/admin/users/search?q=${encodeURIComponent(query)}`,
  );
}

export function adminGrantBadge(playerId: string, badgeId: string) {
  return request<{ badges: string[]; activeBadges: string[] }>("/api/player/admin/badges/grant", {
    method: "POST",
    body: { playerId, badgeId },
  });
}

export function adminRevokeBadge(playerId: string, badgeId: string) {
  return request<{ badges: string[]; activeBadges: string[] }>("/api/player/admin/badges/revoke", {
    method: "POST",
    body: { playerId, badgeId },
  });
}

export function adminGrantTheme(playerId: string, themeId: string) {
  return request<{ unlockedThemes: string[] }>("/api/player/admin/themes/grant", {
    method: "POST",
    body: { playerId, themeId },
  });
}

export function adminRevokeTheme(playerId: string, themeId: string) {
  return request<{ unlockedThemes: string[] }>("/api/player/admin/themes/revoke", {
    method: "POST",
    body: { playerId, themeId },
  });
}

export function adminGrantAchievement(playerId: string, achievementId: string) {
  return request<{ granted: boolean; achievements: string[] }>(
    "/api/player/admin/achievements/grant",
    { method: "POST", body: { playerId, achievementId } },
  );
}

export function adminRevokeAchievement(playerId: string, achievementId: string) {
  return request<{ revoked: boolean; achievements: string[] }>(
    "/api/player/admin/achievements/revoke",
    { method: "POST", body: { playerId, achievementId } },
  );
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export type PlayerAchievement = {
  achievementId: string;
  unlockedAt: string;
};

export type AchievementsResponse = {
  achievements: PlayerAchievement[];
  definitions: AchievementDefinition[];
};

export function getMyAchievements() {
  return request<AchievementsResponse>("/api/player/achievements");
}

export function getPlayerAchievements(username: string) {
  return request<AchievementsResponse>(
    `/api/player/profile/${encodeURIComponent(username)}/achievements`,
  );
}

export function reportAIWin(difficulty: 1 | 2 | 3) {
  return request<{ ok: boolean }>("/api/player/achievements/ai-win", {
    method: "POST",
    body: { difficulty },
  });
}
