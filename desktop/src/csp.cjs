// @ts-check
/**
 * Content-Security-Policy strings + the pure helper that decides
 * which one applies.  Lives in its own module (with zero Electron
 * imports) so it can be unit-tested without spinning up the full
 * main-process runtime.
 *
 * See window.cjs for the full rationale on each policy and the
 * conditions that select between them.
 */

/**
 * The strict policy for production / packaged desktop builds.
 *
 * Notable pieces:
 *   - `connect-src 'self' app: https: wss:` — forces every XHR,
 *     fetch, and WebSocket to hit HTTPS/WSS endpoints or the
 *     local `app://tiao/` bundle. Blocks plain `http:` outright.
 *   - `script-src 'unsafe-inline'` — required because Next.js's
 *     static export inlines hydration scripts without nonces. We
 *     pair this with contextIsolation + sandbox + nodeIntegration
 *     off so XSS can't reach privileged APIs.
 *   - `object-src 'none'` / `frame-src 'none'` — blocks legacy
 *     plugin and iframe surfaces entirely.
 */
const PROD_CONTENT_SECURITY_POLICY = [
  "default-src 'self' app:",
  "script-src 'self' app: 'unsafe-inline'",
  "style-src 'self' app: 'unsafe-inline'",
  "img-src 'self' app: data: blob: https:",
  "font-src 'self' app: data:",
  "connect-src 'self' app: https: wss:",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'self' app: blob:",
  "base-uri 'self'",
  "form-action 'self' app:",
].join("; ");

/**
 * Relaxed policy for dev-mode renderers.
 *
 * Two scenarios need this:
 *
 *   1. **HMR mode** (`npm run dev:hmr`) — renderer loads from a
 *      `next dev` server at `http://localhost:*`. Next.js HMR uses
 *      a ws:// websocket and fetches hot-reload modules over http.
 *      React refresh + webpack runtime use `eval`. All of that is
 *      blocked by the prod CSP.
 *
 *   2. **`dev:desktop` mode** — renderer loads from `app://tiao/`
 *      (static export) but the backend runs on `http://localhost:*`
 *      (random port picked by `scripts/dev-desktop.mjs`). The prod
 *      CSP's `connect-src https:` blocks every fetch to that
 *      loopback backend.
 *
 * Safe to relax because both scenarios are `app.isPackaged === false`
 * and the backend is loopback-only. A shipped binary always uses
 * the strict prod policy.
 */
const DEV_CONTENT_SECURITY_POLICY = [
  "default-src 'self' app: http: https:",
  "script-src 'self' app: 'unsafe-inline' 'unsafe-eval' http: https:",
  "style-src 'self' app: 'unsafe-inline' http: https:",
  "img-src 'self' app: data: blob: http: https:",
  "font-src 'self' app: data: http: https:",
  "connect-src 'self' app: http: https: ws: wss:",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'self' app: blob:",
  "base-uri 'self'",
  "form-action 'self' app: http: https:",
].join("; ");

/**
 * Decide whether the relaxed dev CSP should apply.
 *
 * Three cases use the relaxed policy:
 *
 *   1. **HMR mode** — `startUrl` is `http(s)://...`. The renderer
 *      is loading from a `next dev` server, which always needs
 *      ws:/http: for hot-reload and `'unsafe-eval'` for react
 *      refresh.
 *
 *   2. **`dev:desktop` mode** — unpackaged Electron, renderer
 *      loads from `app://tiao/` BUT the backend runs on
 *      `http://localhost:*` (a random 5100-5999 port that
 *      `scripts/dev-desktop.mjs` picked). Without the relaxed
 *      policy the renderer's fetches to `/api/tournaments`,
 *      `/api/auth/get-session`, etc. all fail at the CSP.
 *
 *   3. Anything else → the strict prod policy.
 *
 * Case 2 is gated on `isPackaged === false` so the relaxed policy
 * can never leak into a shipped build: even if a future bug wired
 * `apiUrl` to an http:// origin in a signed binary, the packaged
 * path would still force the prod CSP.
 *
 * @param {{ startUrl: string; apiUrl: string; isPackaged: boolean }} opts
 * @returns {boolean}
 */
function shouldUseDevCsp({ startUrl, apiUrl, isPackaged }) {
  if (/^https?:\/\//i.test(startUrl)) return true; // HMR mode
  if (isPackaged) return false;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(apiUrl);
}

/**
 * Select the policy string to install.
 *
 * @param {{ startUrl: string; apiUrl: string; isPackaged: boolean }} opts
 * @returns {string}
 */
function selectCspPolicy(opts) {
  return shouldUseDevCsp(opts) ? DEV_CONTENT_SECURITY_POLICY : PROD_CONTENT_SECURITY_POLICY;
}

module.exports = {
  PROD_CONTENT_SECURITY_POLICY,
  DEV_CONTENT_SECURITY_POLICY,
  shouldUseDevCsp,
  selectCspPolicy,
};
