"use client";
import { useEffect, useState } from "react";
import { API_BASE_URL } from "@/lib/api";

/**
 * Hook reporting whether the client is currently online.
 *
 * Uses `navigator.onLine` for instant event-driven updates (native
 * browser online/offline events fire immediately when the network
 * state changes) and augments that with a 30-second `/api/health`
 * poll because `navigator.onLine` sometimes lies: it can report
 * "online" when you're on a captive portal, behind a dead router, or
 * connected to a network that drops outbound traffic.
 *
 * Useful primarily for the desktop Electron build — the offline
 * banner and the lobby fallback gate on this value so local games,
 * the computer opponent, and the tutorial stay accessible when the
 * backend is unreachable.  The web app gets its own browser-level
 * offline indicator, so in practice the banner is hidden on web via
 * the `isElectron` check in OfflineBanner.
 *
 * The poll URL is composed from `API_BASE_URL` rather than a bare
 * relative path because a desktop build's document origin is
 * `app://tiao/` — a relative `/api/health` would resolve against
 * the protocol handler (which doesn't serve it) and 404 forever.
 * `API_BASE_URL` is empty-string on web builds (same-origin), so
 * the composed URL degrades to the original relative form there.
 */

const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 5_000;

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    let cancelled = false;

    async function poll() {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
        const res = await fetch(`${API_BASE_URL}/api/health`, { signal: controller.signal });
        clearTimeout(timer);
        if (!cancelled) setIsOnline(res.ok);
      } catch {
        if (!cancelled) setIsOnline(false);
      }
    }

    // Don't poll immediately — trust navigator.onLine for the first
    // render and let the first interval elapse.  Avoids a flash of
    // the offline banner on slow connections where the health check
    // is simply slow rather than failing.
    const intervalId = setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return isOnline;
}
