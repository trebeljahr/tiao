// @ts-check
/**
 * Custom `app://tiao/` protocol handler.
 *
 * Serves files from `desktop/client-bundle/` — a copy of the Next.js
 * static export produced by `npm --prefix client run build:desktop`.
 * Which file a request path maps to is decided by `routes.cjs`, the
 * same rules the mobile apps use (extension-less path -> that route's
 * index.html, missing locale -> en, dynamic routes -> the `__spa__`
 * placeholder page, unknown pages -> the root shell).
 *
 * The desktop export has no root `index.html`, so the root shell is
 * generated here: a tiny page that replaces the URL with a real home
 * page (see `rootShellHtml`).
 *
 * Path traversal (`..`, backslashes, NUL) is rejected by the router,
 * and every resolved file is re-checked to sit inside the bundle
 * root. Protocol handlers in Electron are privileged, so this is the
 * first line of defense against a future XSS gaining filesystem
 * access via URL manipulation.
 */

const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { resolveRoute, rootShellHtml, ROOT_SHELL } = require("./routes.cjs");

const DESKTOP_PROTOCOL_SCHEME = "app";
const DESKTOP_PROTOCOL_HOST = "tiao";

/** Resolve the on-disk directory that holds the Next.js static export. */
function getClientBundleRoot() {
  // Development: `desktop/client-bundle/` lives next to main.cjs.
  const bundled = path.join(__dirname, "..", "client-bundle");
  if (fs.existsSync(bundled)) return bundled;

  // Packaged: electron-builder's extraResources puts it in resources/.
  const resources = path.join(process.resourcesPath || "", "client-bundle");
  if (fs.existsSync(resources)) return resources;

  // Last resort — return the bundled path and let the protocol
  // handler surface a 404 for every request.  main.cjs's
  // did-fail-load handler will catch that and show the corrupted
  // install error page.
  return bundled;
}

/**
 * Map a root-relative web path (leading `/`) to an absolute path
 * inside `root`, or null if it would escape the root.
 *
 * @param {string} root
 * @param {string} webPath
 * @returns {string | null}
 */
function toBundlePath(root, webPath) {
  const normalized = path.normalize(webPath).replace(/^[\\/]+/, "");
  const absolute = path.resolve(root, normalized);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (absolute !== root && !absolute.startsWith(rootWithSep)) return null;
  return absolute;
}

/**
 * Decide what to serve for a request URL path.
 *
 * Critical: `URL.pathname` returns the URL-ENCODED form of the path,
 * so `/_next/static/chunks/app/[locale]/page-*.js` comes in as
 * `/_next/static/chunks/app/%5Blocale%5D/page-*.js`.  We must
 * decodeURIComponent the path BEFORE touching the filesystem, or
 * Next.js's `[locale]` chunk directory (and any other bracketed
 * route segment) is never resolvable.  Decoding can't bypass the
 * traversal guard: `%2E%2E` decodes to a `..` segment, which the
 * router rejects, and `toBundlePath` re-checks the final path.
 *
 * @param {string} urlPath
 * @param {string} [root]
 * @returns {{ file: string } | { html: string } | null}
 *   `file`: absolute path to stream; `html`: generated root shell;
 *   null: refuse (404).
 */
function resolveRequest(urlPath, root = getClientBundleRoot()) {
  // Strip query + hash; the protocol handler doesn't care about them.
  const cleanPath = urlPath.split("?")[0].split("#")[0];
  let decoded;
  try {
    decoded = decodeURIComponent(cleanPath);
  } catch {
    // Malformed percent-escape sequence.  Refuse to serve.
    return null;
  }

  /** @param {string} webPath */
  const exists = (webPath) => {
    const absolute = toBundlePath(root, webPath);
    if (!absolute) return false;
    try {
      return fs.statSync(absolute).isFile();
    } catch {
      return false;
    }
  };

  const webPath = resolveRoute(decoded, exists);
  if (webPath === ROOT_SHELL && !exists(ROOT_SHELL)) {
    return { html: rootShellHtml(decoded) };
  }
  const file = toBundlePath(root, webPath);
  return file ? { file } : null;
}

/**
 * Register the `app://tiao/*` protocol handler with Electron.
 * Must run after `app.whenReady()` — before that, the privileged
 * scheme list (registered by registerSchemesAsPrivileged in
 * main.cjs) exists but handler registration is unavailable.
 */
function registerAppProtocol() {
  // Required here, not at module load, so resolveRequest unit-tests in plain Node.
  const { net, protocol } = require("electron");
  protocol.handle(DESKTOP_PROTOCOL_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== DESKTOP_PROTOCOL_HOST) {
        return new Response("Not found", { status: 404 });
      }

      const resolved = resolveRequest(url.pathname);
      if (!resolved) {
        return new Response("Not found", { status: 404 });
      }
      if ("html" in resolved) {
        return new Response(resolved.html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      const filePath = resolved.file;

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
  // Exported for testing.
  resolveRequest,
};
