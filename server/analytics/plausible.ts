/**
 * Server-side goal events for the self-hosted Plausible instance.
 *
 * The browser already loads the Plausible script for page views (see
 * client/app/[locale]/layout.tsx). This module adds the few outcomes
 * only the server knows for sure, sent through Plausible's Events API
 * (`POST /api/event`). The set is deliberately closed: every name in
 * `PlausibleGoal` must also exist as a custom-event goal on the site,
 * otherwise Plausible stores the event but the dashboard never shows it.
 *
 * Privacy: Plausible is cookieless and does not build user profiles.
 * Never put account ids, emails, names or other personal data into
 * `props` — only coarse, non-identifying categories. Requests leave
 * from the API server, so Plausible sees the server's IP, not the
 * player's.
 *
 * Configuration is env-only. If either var is missing, or the process
 * is not in production, every call is a no-op (safe for forks, CI and
 * tests):
 *
 *   PLAUSIBLE_API_HOST   e.g. https://plausible.trebeljahr.com
 *   PLAUSIBLE_DOMAIN     the site's domain in Plausible, e.g. playtiao.com
 */

export type PlausibleGoal =
  | "user_signed_up"
  | "game_finished"
  | "subscription_started"
  | "tournament_finished";

type GoalProps = Record<string, string | number | boolean>;

const apiHost = process.env.PLAUSIBLE_API_HOST?.replace(/\/$/, "");
const domain = process.env.PLAUSIBLE_DOMAIN;

export const plausibleEnabled =
  Boolean(apiHost) && Boolean(domain) && process.env.NODE_ENV === "production";

/**
 * Fire-and-forget goal event. Never throws and never awaits, so
 * analytics can never block or crash a request handler.
 */
export function trackGoal(name: PlausibleGoal, props: GoalProps = {}): void {
  if (!plausibleEnabled) return;
  void fetch(`${apiHost}/api/event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Plausible drops events whose user agent looks like a bot; a
      // plain product token passes and keeps server traffic recognisable.
      "User-Agent": `TiaoServer/${process.env.APP_VERSION ?? "unknown"}`,
    },
    body: JSON.stringify({
      name,
      domain,
      url: `https://${domain}/server/${name}`,
      props,
    }),
    signal: AbortSignal.timeout(5000),
  })
    .then((res) => {
      if (!res.ok) console.error(`[plausible] ${name} rejected: ${res.status}`);
    })
    .catch((err) => {
      console.error(`[plausible] ${name} failed:`, err);
    });
}
