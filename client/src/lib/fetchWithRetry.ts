import { toast } from "sonner";
import { isRetryableError } from "./errors";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1500, 3000, 5000];

/**
 * Wraps an async fetch call with up to 3 retries and toast notifications.
 * Shows a toast on each retry attempt, and a final error toast if all retries fail.
 *
 * Only *transient* failures (network errors and 5xx) are retried — see
 * `isRetryableError`. Anything else (401/403/404/validation errors) fails
 * fast and silently: retrying can't fix it, and the "Connection issue —
 * retrying…" / "Could not connect to the server" toasts would be actively
 * misleading about what went wrong.
 *
 * This matters most for logged-out visitors. `AuthContext` optimistically
 * hydrates a cached identity from localStorage before it has verified the
 * session cookie, so lobby data fetches can fire while the real session is
 * still being (re)established — a guest session that expired server-side,
 * or cookies cleared while localStorage survived. Those requests come back
 * 401 NOT_AUTHENTICATED for a moment, then succeed once bootstrap has
 * signed a fresh anonymous session in. Treating that window as a
 * connectivity failure is what surfaced a spurious "connection lost" toast
 * on the lobby for users who were never logged in.
 */
export async function fetchWithRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const toastId = `retry-${label}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fn();
      // If we succeeded after retries, dismiss the retry toast
      if (attempt > 0) {
        toast.dismiss(toastId);
      }
      return result;
    } catch (error) {
      if (!isRetryableError(error)) {
        // Dismiss any retry toast from an earlier attempt so a
        // now-permanent failure doesn't leave a stale spinner behind.
        if (attempt > 0) {
          toast.dismiss(toastId);
        }
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        const next = attempt + 1;
        toast.loading(`Connection issue — retrying (${next}/${MAX_RETRIES})...`, {
          id: toastId,
          duration: RETRY_DELAYS[attempt],
        });
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      } else {
        toast.error("Could not connect to the server. Please check your connection.", {
          id: toastId,
        });
        throw error;
      }
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error("Retry exhausted");
}
