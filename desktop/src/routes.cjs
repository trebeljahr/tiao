// @ts-check
/**
 * Maps an `app://tiao/` request path onto a file in the bundled
 * Next.js static export (`client-bundle/`).
 *
 * The static export has one `index.html` per route (`trailingSlash:
 * true`) under a locale folder, and the dynamic routes
 * (`/game/[gameId]` and friends) exist only as a `__spa__`
 * placeholder page. The rules:
 *
 *   1. A path without an extension means that route's `index.html`.
 *   2. A path without a locale means the default locale (`en`), as
 *      with next-intl's `localePrefix: "as-needed"` on the web — the
 *      client's own links are unprefixed, e.g. `router.push("/play")`.
 *   3. A dynamic route's param segment is replaced by `__spa__`, for
 *      the HTML, the RSC payload and the segment prefetch files alike;
 *      the client reads the real value from the URL.
 *   4. `.`/`..` segments and anything else unknown: the root shell
 *      (`/index.html`) for pages, the path as-is (404) for files.
 *
 * Mirrors the mobile routers (mobile/ios/App/App/TiaoRoutes.swift,
 * mobile/android/.../TiaoRoutes.java); all three are tested against
 * mobile/scripts/routes-cases.txt.
 *
 * No Electron imports, so it unit-tests in plain Node.
 */

const PLACEHOLDER = "__spa__";
const LOCALES = /** @type {const} */ (["en", "de", "es"]);
const DEFAULT_LOCALE = "en";
const ROOT_SHELL = "/index.html";

/** Route prefixes after the locale whose next segment is a dynamic param. */
const DYNAMIC_ROUTES = [["game"], ["profile"], ["tournament"], ["embed", "game"]];

/**
 * @param {string[]} parts
 * @param {boolean} hasExtension
 */
function file(parts, hasExtension) {
  const joined = `/${parts.join("/")}`;
  return hasExtension ? joined : `${joined}/index.html`;
}

/**
 * @param {string} path request path, already percent-decoded, e.g. `/en/game/ABC/`
 * @param {(webPath: string) => boolean} exists whether a root-relative path
 *   (leading `/`) is a bundled file
 * @returns {string} the root-relative file to serve
 */
function resolveRoute(path, exists) {
  const segments = (path || "").split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some((s) => s === "." || s === ".." || s.includes("\\") || s.includes("\0"))
  ) {
    return ROOT_SHELL;
  }
  const hasExtension = segments[segments.length - 1].includes(".");

  /** @type {string[][]} */
  const bases = [segments];
  if (!LOCALES.includes(/** @type {any} */ (segments[0]))) {
    bases.push([DEFAULT_LOCALE, ...segments]);
  }
  for (const base of bases) {
    const exact = file(base, hasExtension);
    if (exists(exact)) return exact;
    // Directory segments only: with an extension the last segment is the file name.
    const directoryCount = hasExtension ? base.length - 1 : base.length;
    for (const route of DYNAMIC_ROUTES) {
      const paramIndex = 1 + route.length;
      if (paramIndex >= directoryCount) continue;
      if (!route.every((part, i) => base[1 + i] === part)) continue;
      const rewritten = [...base];
      rewritten[paramIndex] = PLACEHOLDER;
      const candidate = file(rewritten, hasExtension);
      if (exists(candidate)) return candidate;
    }
  }
  return hasExtension ? file(segments, true) : ROOT_SHELL;
}

/**
 * HTML served for the root shell when the bundle has no `/index.html`
 * of its own (the desktop export only has locale folders). It sends
 * the window to a real home page: the request's locale if it has one,
 * else the default. Every target is a real page, so it never loops.
 *
 * @param {string} path the original (decoded) request path
 */
function rootShellHtml(path) {
  const first = (path || "").split("/").filter(Boolean)[0];
  const locale = LOCALES.includes(/** @type {any} */ (first)) ? first : DEFAULT_LOCALE;
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Tiao</title><style>html,body{margin:0;background:#2a1d13}</style><script>location.replace("/${locale}/")</script></head><body></body></html>`;
}

module.exports = {
  resolveRoute,
  rootShellHtml,
  ROOT_SHELL,
  PLACEHOLDER,
  LOCALES,
  DEFAULT_LOCALE,
};
