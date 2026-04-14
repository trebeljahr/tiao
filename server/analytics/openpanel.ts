/**
 * OpenPanel analytics — server-side singleton.
 *
 * Counterpart to client/src/lib/openpanel.ts. Where the web SDK tracks
 * everything the browser sees (page views, clicks, UI flows), the server
 * SDK tracks *authoritative* events that must fire regardless of
 * adblockers or flaky networks: signup, login, game finished, revenue,
 * etc. These are the numbers you actually trust for DAU/retention/revenue.
 *
 * Configuration is env-only — nothing is hardcoded here. If any required
 * var is missing the SDK boots in a disabled state and every call becomes
 * a no-op. Safe default for forks, CI, and `NODE_ENV=test`.
 *
 * Server env vars (see server/.env.example):
 *
 *   OPENPANEL_CLIENT_ID          (required to enable)
 *   OPENPANEL_CLIENT_SECRET      (required to enable — server-only secret)
 *   OPENPANEL_API_URL            (required — URL of the OpenPanel API)
 *   OPENPANEL_ENABLE_IN_DEV      (optional "true" to send from dev)
 *
 * Legal basis:
 *   Events tracked from here generally fall under contract performance /
 *   legitimate interest (e.g. "did the signup succeed", "was the payment
 *   processed", "how many games per day"), so they do NOT require
 *   cookie-style opt-in consent the way the browser SDK does. Still,
 *   avoid tracking raw PII — prefer profileId over email/name in event
 *   properties.
 */

import { OpenPanel, type TrackProperties } from "@openpanel/sdk";

const clientId = process.env.OPENPANEL_CLIENT_ID;
const clientSecret = process.env.OPENPANEL_CLIENT_SECRET;
const apiUrl = process.env.OPENPANEL_API_URL;

const isProd = process.env.NODE_ENV === "production";
const forceEnableInDev = process.env.OPENPANEL_ENABLE_IN_DEV === "true";

export const openPanelEnabled =
  Boolean(clientId) && Boolean(clientSecret) && Boolean(apiUrl) && (isProd || forceEnableInDev);

const instance = new OpenPanel({
  clientId: clientId ?? "disabled",
  clientSecret: clientSecret ?? "disabled",
  apiUrl: apiUrl ?? "https://placeholder.invalid",
  disabled: !openPanelEnabled,
  sdk: "tiao-server",
});

if (openPanelEnabled) {
  instance.setGlobalProperties({
    environment: isProd ? "production" : "development",
    app_version: process.env.APP_VERSION ?? "unknown",
  });
}

/**
 * Fire-and-forget event tracking. Never throws, never awaits — the
 * analytics pipeline must never block or crash a request handler.
 *
 * Always include `profileId` when you have one so events stitch onto
 * the right user profile in the dashboard. For anonymous/guest traffic
 * leave it out; OpenPanel will count it as a device-level event.
 */
export function track(name: string, properties: TrackProperties = {}): void {
  if (!openPanelEnabled) return;
  void instance.track(name, properties).catch((err) => {
    console.error(`[openpanel] track(${name}) failed:`, err);
  });
}

/**
 * Attach profile metadata (email, displayName, custom properties) to a
 * profile id. Usually called on signup/login. Fire-and-forget.
 */
export function identify(profileId: string, properties: Record<string, unknown> = {}): void {
  if (!openPanelEnabled) return;
  const { firstName, lastName, email, avatar, ...rest } = properties as {
    firstName?: string;
    lastName?: string;
    email?: string;
    avatar?: string;
    [key: string]: unknown;
  };
  const result = instance.identify({
    profileId,
    ...(firstName !== undefined ? { firstName } : {}),
    ...(lastName !== undefined ? { lastName } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(avatar !== undefined ? { avatar } : {}),
    properties: rest,
  });
  if (result && typeof (result as Promise<unknown>).catch === "function") {
    void (result as Promise<unknown>).catch((err: unknown) => {
      console.error(`[openpanel] identify(${profileId}) failed:`, err);
    });
  }
}

/**
 * Record a revenue event. `amount` is in the given currency (e.g. 29.99 USD).
 * Prefer this over a plain `track('purchase', ...)` so OpenPanel's revenue
 * dashboards light up. Fire-and-forget.
 */
export function trackRevenue(
  amount: number,
  properties: TrackProperties & { currency: string },
): void {
  if (!openPanelEnabled) return;
  void instance.revenue(amount, properties).catch((err) => {
    console.error("[openpanel] trackRevenue failed:", err);
  });
}

/**
 * Increment a numeric property on a profile (e.g. games_played). Use
 * sparingly — for high-volume counters it's cheaper to compute from the
 * DB on demand than to fire an event per increment.
 */
export function increment(profileId: string, property: string, value = 1): void {
  if (!openPanelEnabled) return;
  void instance.increment({ profileId, property, value }).catch((err) => {
    console.error(`[openpanel] increment(${property}) failed:`, err);
  });
}

export { instance as openPanel };

// --- Export API (read-mode credentials) ------------------------------------

const readClientId = process.env.OPENPANEL_READ_CLIENT_ID;
const readClientSecret = process.env.OPENPANEL_READ_CLIENT_SECRET;

/**
 * True when the Export API can be used — requires the base API URL plus
 * a separate read-mode client. When false, GDPR data exports still work
 * but the `analytics_events` section will be empty.
 */
export const openPanelExportEnabled =
  Boolean(readClientId) && Boolean(readClientSecret) && Boolean(apiUrl);

interface ExportEventsMeta {
  count: number;
  totalCount: number;
  pages: number;
  current: number;
}

/**
 * Fetch all analytics events for a profile from the OpenPanel Export API.
 * Paginates automatically (1 000 events per page). Only includes
 * production events — dev/test noise is filtered out so it never leaks
 * into a user's GDPR export.
 *
 * Returns an empty array when:
 *   - read credentials aren't configured
 *   - OpenPanel is unreachable or returns an error
 *   - the profile simply has no events
 *
 * Never throws — errors are logged and swallowed so the rest of the
 * export always succeeds.
 */
export async function exportOpenPanelEvents(profileId: string): Promise<Record<string, unknown>[]> {
  if (!openPanelExportEnabled || !readClientId || !readClientSecret || !apiUrl) {
    return [];
  }

  const allEvents: Record<string, unknown>[] = [];
  let page = 1;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const url = new URL(`${apiUrl}/export/events`);
      url.searchParams.set("profileId", profileId);
      url.searchParams.set("limit", "1000");
      url.searchParams.set("page", String(page));

      const res = await fetch(url.toString(), {
        headers: {
          "openpanel-client-id": readClientId,
          "openpanel-client-secret": readClientSecret,
        },
      });

      if (!res.ok) {
        console.error(
          `[openpanel] exportOpenPanelEvents(${profileId}) page ${page} failed: ${res.status} ${res.statusText}`,
        );
        break;
      }

      const body = (await res.json()) as {
        meta: ExportEventsMeta;
        data: Record<string, unknown>[];
      };

      // Filter out dev/test events and strip internal fields that aren't
      // the user's personal data. The projectId check catches events from
      // dev OpenPanel projects (e.g. "playtiaocom-dev"); the environment
      // check catches prod-project events tagged as development.
      for (const evt of body.data) {
        const pid = evt.projectId as string | undefined;
        if (pid && /[-_]dev/i.test(pid)) continue;
        const env = (evt.properties as Record<string, unknown> | undefined)?.environment;
        if (env === "development") continue;

        allEvents.push({
          name: evt.name,
          createdAt: evt.createdAt,
          path: evt.path,
          duration: evt.duration,
          country: evt.country,
          city: evt.city,
          os: evt.os,
          browser: evt.browser,
          ...(evt.properties ? { properties: evt.properties } : {}),
        });
      }

      if (page >= body.meta.pages) break;
      page++;
    }
  } catch (err) {
    console.error(`[openpanel] exportOpenPanelEvents(${profileId}) threw:`, err);
  }

  return allEvents;
}

/**
 * GDPR right-to-erasure: ask OpenPanel to delete a profile and all its
 * events from the analytics backend. The Node SDK doesn't expose a
 * delete method, so we hit the REST API directly with the client
 * secret for auth.
 *
 * Fire-and-forget — caller should `void` the returned promise. Never
 * throws; failures are logged so the primary account-deletion flow
 * keeps working even if the analytics backend is down.
 *
 * NOTE: the exact endpoint path is OpenPanel-version dependent. The
 * path used below (`/profiles/:id`) matches the current self-hosted
 * REST contract — verify against your OpenPanel version before relying
 * on it in production. If it 404s, check analytics.trebeljahr.com
 * -> API docs and update the path here.
 */
export async function deleteOpenPanelProfile(profileId: string): Promise<void> {
  if (!openPanelEnabled) return;
  if (!clientId || !clientSecret || !apiUrl) return;
  try {
    const res = await fetch(`${apiUrl}/profiles/${encodeURIComponent(profileId)}`, {
      method: "DELETE",
      headers: {
        "openpanel-client-id": clientId,
        "openpanel-client-secret": clientSecret,
      },
    });
    if (!res.ok && res.status !== 404) {
      console.error(
        `[openpanel] deleteOpenPanelProfile(${profileId}) failed: ${res.status} ${res.statusText}`,
      );
    }
  } catch (err) {
    console.error(`[openpanel] deleteOpenPanelProfile(${profileId}) threw:`, err);
  }
}
