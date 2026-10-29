import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getCheckoutStatus, type StripeCheckoutStatus } from "./api";
import { safeLocalStorage } from "./safeLocalStorage";

export function isCheckoutSessionId(value: unknown): value is string {
  return typeof value === "string" && /^cs_(?:test_|live_)?[A-Za-z0-9_]{1,240}$/.test(value);
}

/** Session IDs are hints only; the API verifies ownership and payment every time. */
export function useStripeCheckout(
  playerId: string | null,
  returnedSessionId: string | null,
  onSettled: (result: StripeCheckoutStatus) => void,
) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const callback = useRef(onSettled);
  callback.current = onSettled;
  const storageKey = playerId ? `tiao:stripe-checkout:${playerId}` : null;

  useEffect(() => {
    if (!storageKey) {
      setSessionId(null);
      return;
    }
    const id = isCheckoutSessionId(returnedSessionId)
      ? returnedSessionId
      : safeLocalStorage.getItem(storageKey);
    if (isCheckoutSessionId(id)) {
      safeLocalStorage.setItem(storageKey, id);
      setSessionId(id);
    } else setSessionId(null);
  }, [storageKey, returnedSessionId]);

  const track = useCallback(
    (id: string) => {
      if (!storageKey || !isCheckoutSessionId(id)) return;
      safeLocalStorage.setItem(storageKey, id);
      setSessionId(id);
    },
    [storageKey],
  );

  const stopTracking = useCallback(() => {
    if (storageKey) safeLocalStorage.removeItem(storageKey);
    setSessionId(null);
  }, [storageKey]);

  useEffect(() => {
    if (!sessionId || !storageKey) return;
    let stopped = false;
    let running = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      if (stopped || running || document.visibilityState === "hidden") return;
      clearTimeout(timer);
      running = true;
      try {
        const result = await getCheckoutStatus(sessionId);
        if (stopped) return;
        if (!["open", "pending"].includes(result.status)) {
          stopped = true;
          if (safeLocalStorage.getItem(storageKey) === sessionId)
            safeLocalStorage.removeItem(storageKey);
          setSessionId(null);
          callback.current(result);
          return;
        }
      } catch (error) {
        if (!stopped && error instanceof ApiError && [400, 404].includes(error.status)) {
          stopped = true;
          if (safeLocalStorage.getItem(storageKey) === sessionId)
            safeLocalStorage.removeItem(storageKey);
          setSessionId(null);
        }
        // Network/auth/webhook delays are not payment failures. Keep the hint
        // for the next focus, reconnect, shop visit or application restart.
      } finally {
        running = false;
        if (!stopped) timer = setTimeout(() => void check(), ++attempts < 15 ? 2000 : 15000);
      }
    };
    const resume = () => void check();
    void check();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [sessionId, storageKey]);

  return {
    trackCheckout: track,
    stopTrackingCheckout: stopTracking,
    checkoutPending: sessionId !== null,
  };
}
