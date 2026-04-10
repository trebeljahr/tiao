"use client";

/**
 * Analytics consent — single source of truth for whether the user has
 * opted into OpenPanel tracking. GDPR / ePrivacy requires explicit
 * opt-in before we can fire non-essential tracking events (pageviews,
 * clicks, UI flows). Authoritative server-side events tracked from
 * the Express SDK fall under contract performance and do NOT need
 * this gate.
 *
 * State lives in localStorage under `tiao:analytics-consent` with
 * values "granted" | "denied" | missing (== pending). On initial
 * mount we hydrate from localStorage and, if granted, immediately
 * flip the OpenPanel singleton on via `enableTracking`.
 *
 * Expose `grant` / `revoke` / `status` through the `useAnalyticsConsent`
 * hook. Components consume this to:
 *   - show the cookie banner (status === "pending")
 *   - flip the settings toggle (status === "granted" | "denied")
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { disableTracking, enableTracking, openPanelConfigured } from "@/lib/openpanel";

export type AnalyticsConsentStatus = "pending" | "granted" | "denied";

export const ANALYTICS_CONSENT_STORAGE_KEY = "tiao:analytics-consent";

type AnalyticsConsentContextValue = {
  status: AnalyticsConsentStatus;
  /** True when the build actually ships OpenPanel config. Hides the
   * banner on dev builds and forks where analytics isn't wired up. */
  configured: boolean;
  grant: () => void;
  revoke: () => void;
};

const AnalyticsConsentContext = createContext<AnalyticsConsentContextValue | null>(null);

function readStored(): AnalyticsConsentStatus {
  if (typeof window === "undefined") return "pending";
  try {
    const stored = localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
    if (stored === "granted" || stored === "denied") return stored;
  } catch {
    /* localStorage unavailable — treat as pending */
  }
  return "pending";
}

function writeStored(status: Exclude<AnalyticsConsentStatus, "pending">) {
  try {
    localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, status);
  } catch {
    /* best-effort */
  }
}

export function AnalyticsConsentProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AnalyticsConsentStatus>("pending");

  // Hydrate from localStorage on mount (client-only). If the user has
  // already granted consent in a previous session we flip the OpenPanel
  // instance on immediately — before any component gets a chance to
  // fire an event — so no tracking is lost to the consent round-trip.
  useEffect(() => {
    const stored = readStored();
    setStatus(stored);
    if (stored === "granted") {
      enableTracking();
    }
  }, []);

  const grant = useCallback(() => {
    writeStored("granted");
    setStatus("granted");
    enableTracking();
  }, []);

  const revoke = useCallback(() => {
    writeStored("denied");
    setStatus("denied");
    disableTracking();
  }, []);

  const value: AnalyticsConsentContextValue = {
    status,
    configured: openPanelConfigured,
    grant,
    revoke,
  };

  return (
    <AnalyticsConsentContext.Provider value={value}>{children}</AnalyticsConsentContext.Provider>
  );
}

/**
 * Fallback value returned when the hook is used outside the provider.
 * Keeps isolated unit tests (e.g. `render(<ProfilePage />)` without the
 * full provider tree) working without having to wrap every render call,
 * and makes the consent feature gracefully degrade if any future
 * component tree forgets to mount the provider. `configured: false`
 * ensures consuming UI hides itself (the banner, the settings card)
 * rather than rendering a stub toggle that does nothing.
 */
const NOOP_CONSENT: AnalyticsConsentContextValue = {
  status: "pending",
  configured: false,
  grant: () => {},
  revoke: () => {},
};

export function useAnalyticsConsent(): AnalyticsConsentContextValue {
  return useContext(AnalyticsConsentContext) ?? NOOP_CONSENT;
}
