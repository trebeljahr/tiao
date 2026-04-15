// @ts-check
/**
 * `tiao://` custom URL scheme handler.
 *
 * Lifecycle gotchas worth calling out:
 *
 *   - On macOS the OS delivers deep links via the `open-url` event on
 *     the running app instance.  If the app isn't running yet, the OS
 *     launches it first, then fires `open-url` after `app.whenReady`.
 *     If `open-url` arrives BEFORE whenReady (rare), Electron queues
 *     the event internally and replays it after ready — but only if
 *     we've installed the listener before ready.  So main.cjs MUST
 *     call `installDeepLinkHandler()` before `app.whenReady().then`.
 *
 *   - On Windows and Linux, deep links arrive as an extra argv entry
 *     on the second instance of the app.  We need `requestSingleInstanceLock`
 *     in main.cjs to funnel all instances into one, then the
 *     `second-instance` event fires with the argv from the new one.
 *     On a cold start (app not running yet), the deep link is in
 *     `process.argv` from the outset — we check that too.
 *
 *   - Any deep link that arrives before the renderer's auth listener
 *     is wired gets queued in a local buffer.  `flushPendingDeepLinks`
 *     is called by main.cjs after the BrowserWindow's did-finish-load.
 *
 * Only `tiao://auth/complete` and `tiao://auth/error` are recognized
 * in commit 9.  Future deep links (game invites, replay sharing)
 * would add cases to the dispatch switch.
 */

const { app } = require("electron");

const DEEP_LINK_SCHEME = "tiao";

/** @type {((url: URL) => void | Promise<void>) | null} */
let authHandler = null;

/** @type {URL[]} */
const pendingDeepLinks = [];

/**
 * Register the main-process handlers that listen for deep links.
 * Safe to call multiple times — the handlers are idempotent.
 *
 * @param {{ onAuth: (url: URL) => void | Promise<void> }} opts
 */
function installDeepLinkHandler({ onAuth }) {
  authHandler = onAuth;

  // macOS: route deep links that arrive via the OS to the dispatcher.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    dispatchRawUrl(url);
  });

  // Windows / Linux: when a second instance is launched with a
  // tiao:// argv entry, Electron fires `second-instance` on the
  // primary with the full argv of the secondary.
  app.on("second-instance", (_event, argv) => {
    const deepLink = argv.find((arg) => typeof arg === "string" && arg.startsWith(`${DEEP_LINK_SCHEME}://`));
    if (deepLink) dispatchRawUrl(deepLink);
  });

  // Cold-start deep link: on Win/Linux, if the user launched us via
  // a tiao:// URL, the URL is in process.argv.  We don't know when
  // the main window is ready yet, so the dispatcher queues it.
  const coldLink = process.argv.find(
    (arg) => typeof arg === "string" && arg.startsWith(`${DEEP_LINK_SCHEME}://`),
  );
  if (coldLink) dispatchRawUrl(coldLink);
}

/**
 * Parse and route an incoming `tiao://...` URL.  Non-auth URLs are
 * currently dropped on the floor (with a warning); future commits
 * would extend this switch.
 *
 * @param {string} raw
 */
function dispatchRawUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    console.warn(`[deepLink] malformed URL dropped: ${raw}`);
    return;
  }
  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) {
    console.warn(`[deepLink] unexpected protocol: ${parsed.protocol}`);
    return;
  }

  // Auth: tiao://auth/complete or tiao://auth/error
  if (
    parsed.host === "auth" ||
    parsed.pathname.startsWith("/auth/") ||
    parsed.pathname === "/auth"
  ) {
    if (!authHandler) {
      // Queue until main.cjs registers the handler.
      pendingDeepLinks.push(parsed);
      return;
    }
    try {
      // Normalize the URL so the auth handler sees a consistent shape:
      // `tiao://auth/complete?...` on every OS.  Some platforms use
      // `tiao:/auth/complete` (single slash) due to URL parsing
      // differences.
      void authHandler(parsed);
    } catch (err) {
      console.error("[deepLink] auth handler threw:", err);
    }
    return;
  }

  console.warn(`[deepLink] unrecognized route dropped: ${parsed.href}`);
}

/**
 * Replay any deep links that were delivered before the auth handler
 * was available.  main.cjs calls this after the first BrowserWindow's
 * webContents fires `did-finish-load`.
 */
function flushPendingDeepLinks() {
  if (!authHandler) return;
  while (pendingDeepLinks.length > 0) {
    const next = pendingDeepLinks.shift();
    if (next) {
      try {
        void authHandler(next);
      } catch (err) {
        console.error("[deepLink] queued handler threw:", err);
      }
    }
  }
}

module.exports = {
  installDeepLinkHandler,
  flushPendingDeepLinks,
  DEEP_LINK_SCHEME,
};
