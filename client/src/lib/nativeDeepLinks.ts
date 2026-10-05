import { locales } from "@/i18n/routing";

/**
 * Deep links into the mobile (Capacitor) app.
 *
 * `tiao://game/ABC123` and `https://playtiao.com/de/profile/rico` open the
 * matching in-app page. The native App plugin keeps a cold-start URL
 * until the first listener consumes it, so the listener in
 * `NativeDeepLinkHandler` also covers launches from a link.
 *
 * `tiao://auth/...` belongs to the sign-in flow and is never navigated
 * to. Those URLs are queued for `onAuthDeepLink` so the auth code can
 * pick them up even when it subscribes after a cold start.
 */

const WEB_HOSTS = new Set(["playtiao.com", "www.playtiao.com"]);
const AUTH_HOST = "auth";

/**
 * Map a deep link to an in-app path, or null if it is not a page link.
 * Links without a locale keep the locale the user is browsing in, so a
 * German user stays in German.
 */
export function deepLinkToPath(rawUrl: string, currentPathname = "/"): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  let segments: string[];
  if (url.protocol === "tiao:") {
    if (url.hostname === AUTH_HOST) return null;
    segments = [url.hostname, ...url.pathname.split("/")];
  } else if (url.protocol === "https:" && WEB_HOSTS.has(url.hostname)) {
    segments = url.pathname.split("/");
  } else {
    return null;
  }
  segments = segments.filter(Boolean);
  if (segments.some((s) => s === "." || s === "..")) return null;

  const isLocale = (s: string | undefined) => (locales as readonly string[]).includes(s ?? "");
  if (!isLocale(segments[0])) {
    const current = currentPathname.split("/").filter(Boolean)[0];
    if (isLocale(current)) segments.unshift(current as string);
  }
  const path = segments.length ? `/${segments.join("/")}/` : "/";
  return path + url.search + url.hash;
}

export function isAuthDeepLink(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "tiao:" && url.hostname === AUTH_HOST;
  } catch {
    return false;
  }
}

type AuthListener = (url: string) => void;
const pendingAuthUrls: string[] = [];
const authListeners = new Set<AuthListener>();

/** Called by the deep-link listener for `tiao://auth/...` URLs. */
export function dispatchAuthDeepLink(url: string): void {
  if (authListeners.size === 0) {
    pendingAuthUrls.push(url);
    return;
  }
  for (const listener of authListeners) listener(url);
}

/** Subscribe to OAuth return links; replays any that arrived earlier. */
export function onAuthDeepLink(listener: AuthListener): () => void {
  authListeners.add(listener);
  for (const url of pendingAuthUrls.splice(0)) listener(url);
  return () => {
    authListeners.delete(listener);
  };
}
