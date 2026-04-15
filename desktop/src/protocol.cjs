// @ts-check
/**
 * Custom `app://tiao/` protocol handler.
 *
 * Serves files from `desktop/client-bundle/` — a copy of the Next.js
 * static export produced by `npm --prefix client run build:desktop`.
 * Every `app://tiao/<path>` URL maps to a file under that directory,
 * with three special behaviors:
 *
 *   1. Locale-prefixed paths like `/en/local/` resolve to the
 *      generated `en/local/index.html`.  `trailingSlash: true` in the
 *      Next config guarantees every static page lives at a
 *      `.../index.html`.
 *
 *   2. The three shareable dynamic routes — `/game/[gameId]`,
 *      `/profile/[username]`, `/tournament/[tournamentId]` — were
 *      baked as a single `__spa__` placeholder HTML file in the
 *      static export (see commits 4-5).  Requests for a real game ID
 *      like `/en/game/ABC123/` are rewritten to serve
 *      `en/game/__spa__/index.html`, and the runtime helper in
 *      `client/src/lib/desktopPathParam.ts` reads the real segment
 *      from `window.location.pathname` once React hydrates.
 *
 *   3. Path traversal attempts (`..`, absolute paths, backslashes
 *      on Windows) are rejected up front — if a resolved file path
 *      escapes the client bundle root, we return 404.  Protocol
 *      handlers in Electron are privileged, so this check is the
 *      first line of defense against a future XSS gaining filesystem
 *      access via URL manipulation.
 */

const { app, net, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const DESKTOP_PROTOCOL_SCHEME = "app";
const DESKTOP_PROTOCOL_HOST = "tiao";

// SPA route prefixes that get rewritten to the __spa__ placeholder
// HTML at request time.  The order matters: we match the longest
// prefix first so a URL like `/game/ABC/replay/2` still resolves.
// Paired with `client/app/[locale]/<prefix>/[param]/page.tsx`.
const SPA_ROUTES = /** @type {const} */ (["game", "profile", "tournament"]);
const SPA_PLACEHOLDER_SEGMENT = "__spa__";

/** Resolve the on-disk directory that holds the Next.js static export. */
function getClientBundleRoot() {
  // Development + first-time packaging: `desktop/client-bundle/`
  // lives next to main.cjs.  When packaged by electron-builder in
  // commit 11 the path will shift under `app.asar/...` but
  // __dirname still resolves relative to this file at runtime.
  const bundled = path.join(__dirname, "..", "client-bundle");
  if (fs.existsSync(bundled)) return bundled;

  // Fallback: resources/ (electron-builder packaged layout).
  const resources = path.join(process.resourcesPath || "", "client-bundle");
  if (fs.existsSync(resources)) return resources;

  // Last resort — return the bundled path and let the protocol
  // handler surface a 404 for every request.  main.cjs's
  // did-fail-load handler will catch that and show the corrupted
  // install error page.
  return bundled;
}

/**
 * Rewrite SPA route URLs to their placeholder HTML.
 *
 * Input examples:
 *   /en/game/ABC123/          -> /en/game/__spa__/
 *   /de/profile/rico/         -> /de/profile/__spa__/
 *   /en/tournament/T42/foo    -> /en/tournament/__spa__/ (extra segs dropped)
 *   /en/local/                -> /en/local/            (unchanged)
 *
 * @param {string} urlPath
 * @returns {string}
 */
function applySpaRewrite(urlPath) {
  // Path format is always `/<locale>/<rest>`; the locale is the
  // first non-empty segment.
  const segments = urlPath.split("/").filter(Boolean);
  if (segments.length < 2) return urlPath;
  const [locale, prefix] = segments;
  if (!SPA_ROUTES.includes(/** @type {typeof SPA_ROUTES[number]} */ (prefix))) {
    return urlPath;
  }
  // Matches one of the SPA prefixes — rewrite to `/<locale>/<prefix>/__spa__/`.
  // Preserve the trailing slash so the handler resolves to index.html.
  return `/${locale}/${prefix}/${SPA_PLACEHOLDER_SEGMENT}/`;
}

/**
 * Turn a request URL path into an absolute filesystem path inside
 * the client bundle root.  Returns null if the result escapes the
 * root (path-traversal guard) or if the input URL can't be decoded.
 *
 * Critical: `URL.pathname` returns the URL-ENCODED form of the path,
 * so `/_next/static/chunks/app/[locale]/page-*.js` comes in as
 * `/_next/static/chunks/app/%5Blocale%5D/page-*.js`.  We must
 * decodeURIComponent the path BEFORE touching the filesystem, or
 * Next.js's `[locale]` chunk directory (and any other bracketed
 * route segment) is never resolvable.  The path-traversal check
 * below runs on the resolved absolute path, so decoding here can't
 * bypass the guard via `%2E%2E%2F` → `../` — path.resolve eats the
 * `..` segments, path.startsWith(root) still rejects escapees.
 *
 * @param {string} urlPath
 * @returns {string | null}
 */
function resolveBundleFile(urlPath) {
  // Strip query + hash; the protocol handler doesn't care about them.
  const cleanPath = urlPath.split("?")[0].split("#")[0];

  // Decode percent-escapes so `[locale]` (serialized as `%5Blocale%5D`
  // by the browser) matches the literal directory name on disk.
  let decoded;
  try {
    decoded = decodeURIComponent(cleanPath);
  } catch {
    // Malformed percent-escape sequence.  Refuse to serve.
    return null;
  }

  // Apply SPA rewrite BEFORE we resolve to disk so `/en/game/ABC`
  // maps to `en/game/__spa__/index.html`.
  const rewritten = applySpaRewrite(decoded);

  // Trailing-slash directories get an implicit `index.html`.
  const withIndex = rewritten.endsWith("/") ? `${rewritten}index.html` : rewritten;

  const root = getClientBundleRoot();
  const normalized = path.normalize(withIndex).replace(/^[\\/]+/, "");
  const absolute = path.resolve(root, normalized);

  // Path traversal check: if the resolved path escaped the root,
  // refuse to serve.
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (absolute !== root && !absolute.startsWith(rootWithSep)) {
    return null;
  }
  return absolute;
}

/**
 * Register the `app://tiao/*` protocol handler with Electron.
 * Must run after `app.whenReady()` — before that, the privileged
 * scheme list (registered by registerSchemesAsPrivileged in
 * main.cjs) exists but handler registration is unavailable.
 */
function registerAppProtocol() {
  protocol.handle(DESKTOP_PROTOCOL_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== DESKTOP_PROTOCOL_HOST) {
        return new Response("Not found", { status: 404 });
      }

      const filePath = resolveBundleFile(url.pathname);
      if (!filePath) {
        return new Response("Not found", { status: 404 });
      }

      try {
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile()) {
          return new Response("Not found", { status: 404 });
        }
      } catch {
        return new Response("Not found", { status: 404 });
      }

      // net.fetch is Electron's recommended way to stream a file
      // back through the protocol — handles range requests and
      // content-type sniffing automatically.
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      console.error("[protocol] handler error:", err);
      return new Response("Internal error", { status: 500 });
    }
  });
}

module.exports = {
  registerAppProtocol,
  DESKTOP_PROTOCOL_SCHEME,
  DESKTOP_PROTOCOL_HOST,
  // Exported for testing via the desktop typecheck.
  applySpaRewrite,
  resolveBundleFile,
};
