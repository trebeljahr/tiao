/**
 * Fire-and-forget Discord webhook client.
 *
 * Discord webhooks are a side channel — a community feed, never part of a
 * request's contract — so this module is built to fail quietly: a slow or
 * dead Discord must never stall or crash the code path that triggered the
 * post. Every failure mode (bad URL, network error, non-2xx, timeout) turns
 * into a `false` return plus a warning log.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("discord");

/** Discord drops webhook posts with an empty or >2000-char `content`. */
const MAX_CONTENT_LENGTH = 2000;

export const WEBHOOK_TIMEOUT_MS = 5_000;

export type WebhookFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

export type PostWebhookOptions = {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: WebhookFetch;
  timeoutMs?: number;
};

/**
 * POST a plain-text message to a Discord webhook URL.
 *
 * Resolves `true` when Discord accepted the post, `false` otherwise. Never
 * rejects.
 */
export async function postWebhook(
  url: string,
  content: string,
  options: PostWebhookOptions = {},
): Promise<boolean> {
  const fetchImpl: WebhookFetch = options.fetchImpl ?? ((u, init) => fetch(u, init));
  const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, MAX_CONTENT_LENGTH) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      log.warn("webhook rejected", { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    // Timeouts surface as an AbortError / TimeoutError; network failures as
    // TypeError. Neither is worth a GlitchTip event — Discord being flaky is
    // not a bug in this server.
    log.warn("webhook post failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
