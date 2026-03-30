import { toast } from "sonner";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1500, 3000, 5000];

/**
 * Wraps an async fetch call with up to 3 retries and toast notifications.
 * Shows a toast on each retry attempt, and a final error toast if all retries fail.
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
