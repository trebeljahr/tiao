import type { AuthResponse, MultiplayerSnapshot, PlayerIdentity } from "@shared";

type JsonBody = Record<string, unknown> | undefined;

export type AccountProfile = {
  displayName: string;
  email: string;
  profilePicture?: string;
  createdAt?: string;
  updatedAt?: string;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getApiBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL as string;
  }

  return window.location.origin;
}

export const API_BASE_URL = getApiBaseUrl();

export function buildWebSocketUrl(gameId: string, token: string) {
  const url = new URL(API_BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("gameId", gameId);
  url.searchParams.set("token", token);
  return url.toString();
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: JsonBody;
    token?: string;
  } = {}
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
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
  } & T;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.message || "The request could not be completed."
    );
  }

  return data;
}

async function upload<T>(path: string, formData: FormData, token: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
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
  } & T;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.message || "The request could not be completed."
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

export function getCurrentPlayer(token: string) {
  return request<{ player: PlayerIdentity }>("/api/player/me", {
    token,
  });
}

export function loginWithEmail(email: string, password: string) {
  return request<AuthResponse>("/api/player/login", {
    method: "POST",
    body: {
      email,
      password,
    },
  });
}

export function signUpWithEmail(
  email: string,
  password: string,
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

export function createMultiplayerGame(token: string) {
  return request<{ snapshot: MultiplayerSnapshot }>("/api/games", {
    method: "POST",
    token,
  });
}

export function joinMultiplayerGame(token: string, gameId: string) {
  return request<{ snapshot: MultiplayerSnapshot }>(
    `/api/games/${gameId}/join`,
    {
      method: "POST",
      token,
    }
  );
}

export function resetMultiplayerGame(token: string, gameId: string) {
  return request<{ snapshot: MultiplayerSnapshot }>(`/api/games/${gameId}/reset`, {
    method: "POST",
    token,
  });
}

export function getAccountProfile(token: string) {
  return request<{ profile: AccountProfile }>("/api/player/profile", {
    token,
  });
}

export function updateAccountProfile(
  token: string,
  body: {
    displayName?: string;
    email?: string;
  }
) {
  return request<{ auth: AuthResponse; profile: AccountProfile }>(
    "/api/player/profile",
    {
      method: "PUT",
      body,
      token,
    }
  );
}

export function uploadAccountProfilePicture(token: string, file: File) {
  const formData = new FormData();
  formData.set("profilePicture", file);

  return upload<{ auth: AuthResponse; profile: AccountProfile }>(
    "/api/player/profile-picture",
    formData,
    token
  );
}
