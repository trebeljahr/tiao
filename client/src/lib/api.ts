import type {
  AuthResponse,
  MatchmakingState,
  MultiplayerGamesIndex,
  MultiplayerSnapshot,
  PlayerIdentity,
  SocialOverview,
  SocialSearchResult,
  TournamentListItem,
  TournamentSettings,
  TournamentSnapshot,
  TournamentStatus,
} from "@shared";

type JsonBody = Record<string, unknown> | undefined;

export type AccountProfile = {
  displayName: string;
  email?: string;
  profilePicture?: string;
  createdAt?: string;
  updatedAt?: string;
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
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL as string;
  }

  return window.location.origin;
}

export const API_BASE_URL = getApiBaseUrl();

export function buildWebSocketUrl(gameId: string) {
  const url = new URL(API_BASE_URL);
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
  } = {}
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
    throw new ApiError(
      0,
      "Could not reach the server. Make sure the backend is running."
    );
  }

  const data = (await response.json().catch(() => ({}))) as {
    message?: string;
    code?: string;
  } & T;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.message || "The request could not be completed.",
      data.code
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
    throw new ApiError(
      0,
      "Could not reach the server. Make sure the backend is running."
    );
  }

  const data = (await response.json().catch(() => ({}))) as {
    message?: string;
    code?: string;
  } & T;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.message || "The request could not be completed.",
      data.code
    );
  }

  return data;
}

export function createGuest(displayName?: string) {
  return request<AuthResponse>("/api/player/guest", {
    method: "POST",
    body: displayName ? { displayName } : undefined,
  });
}

export function getCurrentPlayer() {
  return request<{ player: PlayerIdentity }>("/api/player/me");
}

export function login(identifier: string, password: string) {
  return request<AuthResponse>("/api/player/login", {
    method: "POST",
    body: {
      identifier,
      password,
    },
  });
}

export function signUpWithEmail(
  email?: string,
  password?: string,
  displayName?: string
) {
  return request<AuthResponse>("/api/player/signup", {
    method: "POST",
    body: {
      email,
      password,
      displayName,
    },
  });
}

export function logoutPlayer() {
  return request<void>("/api/player/logout", {
    method: "POST",
  });
}

export function createMultiplayerGame(
  settings?: { boardSize?: number; scoreToWin?: number },
) {
  return request<{ snapshot: MultiplayerSnapshot }>("/api/games", {
    method: "POST",
    body: settings,
  });
}

export function joinMultiplayerGame(gameId: string) {
  return request<{ snapshot: MultiplayerSnapshot }>(
    `/api/games/${gameId}/join`,
    {
      method: "POST",
    }
  );
}

export function accessMultiplayerGame(gameId: string) {
  return request<{ snapshot: MultiplayerSnapshot }>(
    `/api/games/${gameId}/access`,
    {
      method: "POST",
    }
  );
}

export function getMultiplayerGame(gameId: string) {
  return request<{ snapshot: MultiplayerSnapshot }>(`/api/games/${gameId}`);
}

export function listMultiplayerGames() {
  return request<{ games: MultiplayerGamesIndex }>("/api/games");
}

export function enterMatchmaking(options?: {
  timeControl?: { initialMs: number; incrementMs: number } | null;
}) {
  return request<{ matchmaking: MatchmakingState }>("/api/matchmaking", {
    method: "POST",
    body: options?.timeControl ? { timeControl: options.timeControl } : undefined,
  });
}

export function getMatchmakingState() {
  return request<{ matchmaking: MatchmakingState }>("/api/matchmaking");
}

export function leaveMatchmaking() {
  return request<void>("/api/matchmaking", {
    method: "DELETE",
  });
}

export function getSocialOverview() {
  return request<{ overview: SocialOverview }>("/api/player/social/overview");
}

export function searchPlayers(query: string) {
  return request<{ results: SocialSearchResult[] }>(
    `/api/player/social/search?q=${encodeURIComponent(query)}`,
    {}
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
  return request<{ message: string }>(
    `/api/player/social/friend-requests/${accountId}/accept`,
    {
      method: "POST",
    }
  );
}

export function declineFriendRequest(accountId: string) {
  return request<{ message: string }>(
    `/api/player/social/friend-requests/${accountId}/decline`,
    {
      method: "POST",
    }
  );
}

export function cancelFriendRequest(accountId: string) {
  return request<{ message: string }>(
    `/api/player/social/friend-requests/${accountId}/cancel`,
    {
      method: "POST",
    }
  );
}

export function removeFriend(accountId: string) {
  return request<{ message: string }>(
    `/api/player/social/friends/${accountId}/remove`,
    { method: "POST" }
  );
}

export function sendGameInvitation(
  body: {
    gameId: string;
    recipientId: string;
    expiresInMinutes: number;
  }
) {
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
    }
  );
}

export function declineGameInvitation(invitationId: string) {
  return request<{ message: string }>(
    `/api/player/social/game-invitations/${invitationId}/decline`,
    {
      method: "POST",
    }
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

export function updateAccountProfile(
  body: {
    displayName?: string;
    email?: string;
    password?: string;
    currentPassword?: string;
  }
) {
  return request<{ auth: AuthResponse; profile: AccountProfile }>(
    "/api/player/profile",
    {
      method: "PUT",
      body,
    }
  );
}

export function uploadAccountProfilePicture(file: File) {
  const formData = new FormData();
  formData.set("profilePicture", file);

  return upload<{ auth: AuthResponse; profile: AccountProfile }>(
    "/api/player/profile-picture",
    formData
  );
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
  return request<{ tournament: TournamentSnapshot }>(
    `/api/tournaments/${tournamentId}`
  );
}

export function registerForTournament(tournamentId: string, inviteCode?: string) {
  return request<{ tournament: TournamentSnapshot }>(
    `/api/tournaments/${tournamentId}/register`,
    {
      method: "POST",
      body: inviteCode ? { inviteCode } : undefined,
    }
  );
}

export function unregisterFromTournament(tournamentId: string) {
  return request<{ tournament: TournamentSnapshot }>(
    `/api/tournaments/${tournamentId}/unregister`,
    { method: "POST" }
  );
}

export function startTournament(tournamentId: string) {
  return request<{ tournament: TournamentSnapshot }>(
    `/api/tournaments/${tournamentId}/start`,
    { method: "POST" }
  );
}

export function cancelTournament(tournamentId: string) {
  return request<{ tournament: TournamentSnapshot }>(
    `/api/tournaments/${tournamentId}/cancel`,
    { method: "POST" }
  );
}

export function updateTournamentSeeding(
  tournamentId: string,
  seeds: { playerId: string; seed: number }[]
) {
  return request<{ tournament: TournamentSnapshot }>(
    `/api/tournaments/${tournamentId}/seeding`,
    {
      method: "PUT",
      body: { seeds } as unknown as Record<string, unknown>,
    }
  );
}

export function randomizeTournamentSeeding(tournamentId: string) {
  return request<{ tournament: TournamentSnapshot }>(
    `/api/tournaments/${tournamentId}/seeding/randomize`,
    { method: "POST" }
  );
}

export function setTournamentFeaturedMatch(
  tournamentId: string,
  matchId: string | null
) {
  return request<{ tournament: TournamentSnapshot }>(
    `/api/tournaments/${tournamentId}/featured-match`,
    {
      method: "PUT",
      body: { matchId },
    }
  );
}

export function forfeitTournamentMatch(
  tournamentId: string,
  matchId: string,
  loserId: string
) {
  return request<{ tournament: TournamentSnapshot }>(
    `/api/tournaments/${tournamentId}/matches/${matchId}/forfeit`,
    {
      method: "POST",
      body: { loserId },
    }
  );
}
