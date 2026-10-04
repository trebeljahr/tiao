import { useEffect, useState } from "react";
import { API_BASE_URL } from "./api";

export type SocialProvider = "github" | "google" | "discord" | "apple";

let providersPromise: Promise<SocialProvider[] | null> | null = null;

/**
 * Social providers the server can complete (GET /api/auth-providers).
 * Resolves null when the server cannot be asked. Cached for the page's
 * lifetime: the server only changes this on a redeploy.
 */
export function fetchEnabledSocialProviders(): Promise<SocialProvider[] | null> {
  providersPromise ??= fetch(`${API_BASE_URL}/api/auth-providers`)
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as { providers?: unknown };
      if (!Array.isArray(data.providers)) return null;
      return data.providers.filter((p): p is SocialProvider =>
        ["github", "google", "discord", "apple"].includes(p as string),
      );
    })
    .catch(() => {
      // Let a later mount retry once the network is back.
      providersPromise = null;
      return null;
    });
  return providersPromise;
}

/** Test-only: forget the cached provider list. */
export function _resetSocialProvidersCacheForTests(): void {
  providersPromise = null;
}

/**
 * Whether Sign in with Apple can be offered. False until the server
 * confirms it — an Apple button that fails would be worse than none.
 */
export function useAppleSignInEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetchEnabledSocialProviders().then((providers) => {
      if (!cancelled) setEnabled(providers?.includes("apple") ?? false);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
