// @ts-check
/**
 * GlitchTip (Sentry-compatible) error monitoring for the Electron
 * main process.
 *
 * Mirror of `server/lib/glitchtip.ts` but scoped to the Node half of
 * the desktop app — the renderer gets its own Sentry SDK init via
 * `client/src/lib/glitchtip.ts`, which is already disabled in
 * desktop builds (commit 4d47e96a: "fix(desktop): URL-decode
 * protocol paths, disable Sentry tunnel, ...").  The two halves
 * should report to different projects so main-process crashes
 * don't mix with server-side or browser errors on the dashboard.
 *
 * Env vars (set at build time via electron-builder extraMetadata
 * or via scripts/release.sh sourcing .env.release):
 *
 *   TIAO_GLITCHTIP_DSN_DESKTOP   — GlitchTip DSN for the desktop
 *                                  main-process project.  When
 *                                  unset, all exports are no-ops
 *                                  and no network traffic happens.
 *
 * Gated to packaged builds — a dev run (`app.isPackaged === false`)
 * never reports to GlitchTip, same rationale as the server wrapper:
 * local errors belong in the terminal where you can see them
 * immediately, not in the production dashboard.
 *
 * Captures three classes of errors:
 *   1. Explicit capture via `captureException(err, ctx)` from
 *      authBridge, deepLink, protocol handler, updater, etc.
 *   2. Uncaught exceptions in the main process (installed via the
 *      `process.on("uncaughtException")` hook below).
 *   3. Unhandled promise rejections (same).
 *
 * Crashes inside the renderer process are NOT visible to this
 * wrapper — the renderer is a separate V8 isolate.  Renderer
 * crashes are the responsibility of the browser Sentry SDK (which,
 * as noted, is off in desktop builds pending a follow-up).
 */

const { app } = require("electron");

// DSN is read once at module load.  It's set by the maintainer's
// .env.release when running scripts/release.sh or by the CI workflow
// when packaging — never hardcoded in source.
const dsn = process.env.TIAO_GLITCHTIP_DSN_DESKTOP;

/**
 * `app.isPackaged` isn't readable before `app.whenReady()` on all
 * platforms, so we read it inside `initGlitchtip()` which is called
 * after bootstrap.  `glitchtipActive` gets set then and controls
 * whether subsequent `captureException` / `setUser` / `flush` calls
 * actually talk to Sentry.
 */
let glitchtipActive = false;

/**
 * Lazy-loaded Sentry module.  Kept local so the dep stays out of the
 * dev path when `dsn` is unset — the `require` at the top of
 * `initGlitchtip` only runs when we know we need it.
 *
 * @type {typeof import('@sentry/node') | null}
 */
let Sentry = null;

/**
 * Initialize Sentry for the main process.  Safe to call
 * unconditionally — this function no-ops when:
 *   - running in dev (`!app.isPackaged`)
 *   - `TIAO_GLITCHTIP_DSN_DESKTOP` is unset
 *   - `@sentry/node` failed to load (missing dep, sandbox, etc.)
 *
 * Must be called BEFORE other main-process modules that want to
 * report errors through this wrapper (authBridge, deepLink,
 * protocol).  Call order in main.cjs's `bootstrap()`:
 *
 *   initGlitchtip();
 *   registerAppProtocol();
 *   loadPersistedToken();
 *   registerAuthIpc();
 *   ...
 */
function initGlitchtip() {
  if (!dsn) return;
  if (!app.isPackaged) {
    console.info("[glitchtip] skipped (dev mode)");
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Sentry = require("@sentry/node");
  } catch (err) {
    console.warn("[glitchtip] @sentry/node not available:", err);
    return;
  }

  Sentry.init({
    dsn,
    environment: "production",
    release: process.env.TIAO_DESKTOP_VERSION || app.getVersion(),
    // Tag every event as coming from the main process so the
    // dashboard can separate these from renderer / server errors
    // if they ever land in the same project by accident.
    initialScope: {
      tags: { process: "main", platform: process.platform },
    },
    // Keep breadcrumbs minimal — Electron main process errors are
    // usually single-shot and don't benefit from the big request/
    // response history a web app captures.
    maxBreadcrumbs: 30,
  });

  glitchtipActive = true;

  // Global handlers.  Sentry's init() automatically registers
  // `uncaughtException` and `unhandledRejection` hooks in @sentry/node
  // ≥ 8 (via the default integrations), but we belt-and-suspenders
  // it here because a silent "events never fire" is a bad failure
  // mode for a crash reporter.
  process.on("uncaughtException", (err) => {
    console.error("[glitchtip] uncaughtException:", err);
    captureException(err, { kind: "uncaughtException" });
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[glitchtip] unhandledRejection:", reason);
    captureException(reason instanceof Error ? reason : new Error(String(reason)), {
      kind: "unhandledRejection",
    });
  });
}

/**
 * Capture an exception.  No-op when Glitchtip isn't active.  The
 * optional context goes onto the event's `extra` scope so the
 * dashboard surfaces it alongside the stack trace.
 *
 * @param {unknown} error
 * @param {Record<string, unknown>} [context]
 */
function captureException(error, context) {
  if (!glitchtipActive || !Sentry) return;
  // Alias to a local const so TypeScript's narrowing survives the
  // withScope closure — without this, tsc with strict + checkJs
  // thinks Sentry could be reassigned to null before the inner
  // call to captureException.
  const sentry = Sentry;
  try {
    sentry.withScope((scope) => {
      if (context) scope.setExtras(context);
      sentry.captureException(error);
    });
  } catch (err) {
    // Never let a crash-reporter failure break the caller.
    console.error("[glitchtip] captureException failed:", err);
  }
}

/**
 * Associate the current user with subsequent events.  Called by
 * authBridge after a successful OAuth exchange so errors can be
 * traced back to a player ID.
 *
 * @param {{ id: string; username?: string } | null} user
 */
function setUser(user) {
  if (!glitchtipActive || !Sentry) return;
  try {
    Sentry.setUser(user);
  } catch {
    /* best-effort */
  }
}

/**
 * Flush any pending events.  Called from the graceful-shutdown path
 * in main.cjs before the process exits so we don't lose in-flight
 * captures.
 *
 * @param {number} [timeoutMs]
 */
async function flush(timeoutMs = 2000) {
  if (!glitchtipActive || !Sentry) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    /* best-effort — process is exiting anyway */
  }
}

module.exports = {
  initGlitchtip,
  captureException,
  setUser,
  flush,
};
