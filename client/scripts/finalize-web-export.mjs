#!/usr/bin/env node

/**
 * Turn the web export (`next build` → client/out) into the site that
 * Cloudflare Workers static assets serves at playtiao.com.
 *
 *   node scripts/finalize-web-export.mjs [--out out] [--commit <sha>]
 *        [--app-version <v>] [--carried <dir>]
 *
 * Defaults: --commit from BUILD_COMMIT, else `git rev-parse HEAD`;
 * --app-version from APP_VERSION; --carried from RELEASE_CARRY_DIR, else
 * release-carry/ when it holds a releases.json. `pnpm build` runs it.
 *
 * 1. Default locale at the root. Next writes every locale into its own
 *    folder (`en.html`, `en/play.html`, `de/play.html`). The app uses
 *    next-intl's `localePrefix: "as-needed"`, so English is served without
 *    a prefix: `en/` moves to the root (`/` is `index.html`, `/play` is
 *    `play.html`) and `/en/...` redirects there, as the middleware did.
 * 2. `_redirects`. The dynamic routes (`/game/<id>` and friends) are baked
 *    once with the `__spa__` placeholder. The Worker (worker/index.mjs)
 *    serves a page and its RSC payload (`<path>.txt`); the rules here serve
 *    the segment prefetch files (`<path>/__next.*.txt`) and redirect a
 *    trailing slash. Cloudflare does not apply rules in file order, so no
 *    request may match two rules with different results: that is why the
 *    page and payload are not rules, and why locales are listed one by one.
 * 3. `_headers`. Frame policy (deny everywhere except `/embed`, as
 *    src/lib/frameHeaders.ts and the middleware sent it), `no-cache` for the
 *    service worker, `no-store` for the release files.
 * 4. Earlier releases' `/_next/static` files from `--carried` (filled by
 *    `carry-release-static.mjs fetch`), checked for collisions, and
 *    `release-assets.json`, which lists every release this upload serves so
 *    the next build can carry them.
 * 5. `version.json`, and the Workers Free limits.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { verify } from "./carry-release-static.mjs";

export const LOCALES = ["en", "de", "es"];
export const DEFAULT_LOCALE = "en";
export const PLACEHOLDER = "__spa__";

// Workers Free limits (developers.cloudflare.com/workers/platform/limits/).
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_HEADER_RULES = 100;
const MAX_DYNAMIC_REDIRECTS = 100;
const MAX_REDIRECTS = 2_100;

const SHA = /^[0-9a-f]{40}$/;

/** Every file under `dir`, as `/`-separated paths relative to it. */
export function listFiles(dir) {
  const found = [];
  if (!existsSync(dir)) return found;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in the export: ${path}`);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) found.push(relative(dir, path).split(sep).join("/"));
    }
  };
  walk(dir);
  return found.sort();
}

/** Moves `<out>/<locale>.html|.txt` and `<out>/<locale>/**` to the root of `out`. */
export function moveLocaleToRoot(out, locale = DEFAULT_LOCALE) {
  const moves = [
    [`${locale}.html`, "index.html"],
    [`${locale}.txt`, "index.txt"],
    ...listFiles(join(out, locale)).map((path) => [`${locale}/${path}`, path]),
  ];
  for (const [from, to] of moves) {
    if (!existsSync(join(out, from))) throw new Error(`Export has no ${from}`);
    if (existsSync(join(out, to))) throw new Error(`Moving ${from} would overwrite ${to}`);
  }
  for (const [from, to] of moves) {
    mkdirSync(dirname(join(out, to)), { recursive: true });
    renameSync(join(out, from), join(out, to));
  }
  rmSync(join(out, locale), { recursive: true, force: true });
  return moves.length;
}

/**
 * Route prefixes whose next segment is a dynamic param, found from the
 * placeholder pages at the root (`game/__spa__.html` → `game`). Every other
 * locale must have the same set.
 */
export function placeholderRoutes(out) {
  const suffix = `/${PLACEHOLDER}.html`;
  const routes = listFiles(out)
    .filter((path) => path.endsWith(suffix))
    .map((path) => path.slice(0, -suffix.length));
  const atRoot = routes.filter((route) => !LOCALES.includes(route.split("/")[0]));
  for (const locale of LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
    const own = routes
      .filter((route) => route.startsWith(`${locale}/`))
      .map((route) => route.slice(locale.length + 1));
    if (own.join() !== atRoot.join())
      throw new Error(`Placeholder routes differ: ${locale} has [${own}], root has [${atRoot}]`);
  }
  if (!atRoot.length) throw new Error("Export has no placeholder pages");
  return atRoot;
}

/**
 * The `_redirects` file. No request matches two rules with different
 * results, except `/x/<id>/`, where the redirect also sorts first.
 */
export function redirectsFile(routes) {
  const lines = [
    "# Generated by client/scripts/finalize-web-export.mjs.",
    "# English lives at the root (next-intl localePrefix: as-needed).",
    `/${DEFAULT_LOCALE} / 301`,
    `/${DEFAULT_LOCALE}/* /:splat 301`,
    "# Segment prefetch files of the dynamic routes come from the __spa__",
    "# placeholder; the Worker serves the pages and their RSC payloads.",
  ];
  const bases = ["", ...LOCALES.filter((l) => l !== DEFAULT_LOCALE).map((l) => `/${l}`)];
  for (const base of bases) {
    for (const route of routes) {
      const path = `${base}/${route}`;
      lines.push(`${path}/:id/ ${path}/:id 308`, `${path}/:id/* ${path}/${PLACEHOLDER}/:splat 200`);
    }
  }
  return `${lines.join("\n")}\n`;
}

const FRAME_DENY = ["X-Frame-Options: DENY", "Content-Security-Policy: frame-ancestors 'none'"];
const FRAME_ALLOW = [
  "! X-Frame-Options",
  "! Content-Security-Policy",
  "Content-Security-Policy: frame-ancestors *",
];

/** The `_headers` file. */
export function headersFile() {
  const rules = [
    ["/*", FRAME_DENY],
    // The one surface built for third-party iframes (finished-game replays).
    ["/embed/*", FRAME_ALLOW],
    ["/:locale/embed/*", FRAME_ALLOW],
    // The browser checks for a new worker on navigation; always revalidate.
    ["/sw.js", ["Cache-Control: no-cache"]],
    // Next's file-based metadata images have no extension to type them by.
    ["/opengraph-image", ["Content-Type: image/png"]],
    ["/twitter-image", ["Content-Type: image/png"]],
    ["/version.json", ["Cache-Control: no-store"]],
    ["/release-assets.json", ["Cache-Control: no-store"]],
  ];
  const body = rules.map(([path, headers]) => [path, ...headers.map((h) => `  ${h}`)].join("\n"));
  return `# Generated by client/scripts/finalize-web-export.mjs.\n${body.join("\n")}\n`;
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * Adds the carried releases' files to `out/_next/static` and writes
 * `release-assets.json`: this release's files first, then each carried
 * release's, newest first.
 */
export function mergeCarried(out, commit, carried) {
  const own = join(out, "_next", "static");
  const releases = [{ sha: commit, files: listFiles(own).map((path) => ({ path })) }];
  if (carried && existsSync(join(carried, "releases.json"))) {
    const result = verify({ own, carried });
    for (const sha of result.releases) {
      if (sha === commit) continue;
      const dir = join(carried, sha);
      const files = listFiles(dir);
      for (const path of files) {
        const target = join(own, path);
        if (!existsSync(target)) {
          mkdirSync(dirname(target), { recursive: true });
          cpSync(join(dir, path), target);
        }
      }
      releases.push({ sha, files: files.map((path) => ({ path })) });
    }
  }
  for (const release of releases)
    for (const file of release.files) file.sha256 = sha256(join(own, file.path));
  writeFileSync(join(out, "release-assets.json"), `${JSON.stringify({ schema: 1, releases })}\n`);
  return releases.map((release) => release.sha);
}

/** Fails when the upload would break a Workers Free limit or a root-served page. */
export function checkLimits(out) {
  const files = listFiles(out);
  const problems = [];
  if (files.length > MAX_FILES) problems.push(`${files.length} files (limit ${MAX_FILES})`);
  for (const path of files) {
    const bytes = statSync(join(out, path)).size;
    if (bytes > MAX_FILE_BYTES)
      problems.push(`${path} is ${bytes} bytes (limit ${MAX_FILE_BYTES})`);
    // A relative asset prefix only works from file:// and app://; on the
    // web a nested page would load no JavaScript.
    if (path.endsWith(".html") && readFileSync(join(out, path), "utf8").includes('"./_next'))
      problems.push(`${path} references ./_next`);
  }
  const redirects = readFileSync(join(out, "_redirects"), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"));
  const dynamic = redirects.filter((line) => /[*:]/.test(line.split(/\s+/)[0]));
  if (redirects.length > MAX_REDIRECTS) problems.push(`${redirects.length} redirect rules`);
  if (dynamic.length > MAX_DYNAMIC_REDIRECTS)
    problems.push(`${dynamic.length} dynamic redirect rules (limit ${MAX_DYNAMIC_REDIRECTS})`);
  const headerRules = readFileSync(join(out, "_headers"), "utf8")
    .split("\n")
    .filter((line) => line.startsWith("/"));
  if (headerRules.length > MAX_HEADER_RULES) problems.push(`${headerRules.length} header rules`);
  if (problems.length) throw new Error(`Export breaks a limit:\n  ${problems.join("\n  ")}`);
  return { files: files.length, dynamicRedirects: dynamic.length };
}

export function finalize({ out, commit, appVersion, carried, builtAt = new Date() }) {
  if (!SHA.test(commit ?? "")) throw new Error("--commit must be a full git SHA");
  if (existsSync(join(out, "index.html"))) throw new Error(`${out} is already finalized`);
  moveLocaleToRoot(out);
  const routes = placeholderRoutes(out);
  writeFileSync(join(out, "_redirects"), redirectsFile(routes));
  writeFileSync(join(out, "_headers"), headersFile());
  const releases = mergeCarried(out, commit, carried);
  writeFileSync(
    join(out, "version.json"),
    `${JSON.stringify({ commit, version: appVersion ?? null, builtAt: builtAt.toISOString() })}\n`,
  );
  return { routes, releases, ...checkLimits(out) };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--")) throw new Error(`Unexpected argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = args(process.argv.slice(2));
  const commit =
    options.commit ??
    process.env.BUILD_COMMIT ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const carried =
    options.carried ??
    process.env.RELEASE_CARRY_DIR ??
    (existsSync(join("release-carry", "releases.json")) ? "release-carry" : undefined);
  const result = finalize({
    out: options.out ?? "out",
    commit,
    appVersion: options["app-version"] ?? process.env.APP_VERSION,
    carried,
  });
  console.log(JSON.stringify(result));
}
