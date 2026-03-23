import type { AuthResponse } from "@shared";

const AUTH_STORAGE_KEY = "tiao.player-auth";

export function getStoredAuth(): AuthResponse | null {
  const storedValue = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!storedValue) {
    return null;
  }

  try {
    return JSON.parse(storedValue) as AuthResponse;
  } catch {
    return null;
  }
}

export function persistAuth(auth: AuthResponse) {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function clearStoredAuth() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}
