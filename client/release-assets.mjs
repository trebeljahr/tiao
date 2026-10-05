/**
 * Browser assets of earlier releases.
 *
 * A tab keeps running the JavaScript of the release that served its document.
 * After the next deploy it still asks for that release's lazy chunks, which the
 * new container's `.next/static` no longer contains. Each image carries the
 * `/_next/static` files of the previous two releases (see
 * scripts/carry-release-static.mjs); this module serves them when the running
 * build has no file at that path. Next serves its own files as before.
 *
 * Dynamic RSC payloads are never carried. A flight request from a tab of a
 * different release is refused with 409, so the Next router loads one complete
 * document from this release instead of decoding foreign module references.
 */

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

const STATIC_PREFIX = "/_next/static/";

const CONTENT_TYPES = {
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".wasm": "application/wasm",
};

// Already-compressed formats: omit Content-Length, as servePublicFile does, so
// the CDN's recompression cannot leave a mismatched length.
const BINARY = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".woff",
  ".woff2",
  ".mp3",
]);

/** Relative file path under /_next/static/, or null when the URL is not a safe static path. */
export function staticRelativePath(pathname) {
  if (!pathname.startsWith(STATIC_PREFIX)) return null;
  let relative;
  try {
    relative = decodeURIComponent(pathname.slice(STATIC_PREFIX.length));
  } catch {
    return null;
  }
  if (!relative || relative.includes("\0") || relative.includes("\\")) return null;
  const parts = relative.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  return relative;
}

function fileUnder(base, relative) {
  const path = resolve(base, relative);
  if (!path.startsWith(base + sep)) return null;
  try {
    return statSync(path).isFile() ? path : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ ownStaticDir: string, carriedDir: string, deploymentId?: string }} options
 */
export function createReleaseAssets({ ownStaticDir, carriedDir, deploymentId }) {
  const own = resolve(ownStaticDir);
  const carried = resolve(carriedDir);
  let releases = [];
  const manifest = join(carried, "releases.json");
  if (existsSync(manifest)) {
    const parsed = JSON.parse(readFileSync(manifest, "utf8"));
    releases = (Array.isArray(parsed.releases) ? parsed.releases : [])
      .map((row) => row?.sha)
      .filter((sha) => typeof sha === "string" && /^[0-9a-f]{7,40}$/.test(sha))
      .map((sha) => ({ sha, dir: join(carried, sha) }))
      .filter((row) => existsSync(row.dir));
  }

  /** Serves a carried file; returns false so Next handles its own and unknown paths. */
  function serve(req, res, pathname) {
    if (!releases.length || (req.method !== "GET" && req.method !== "HEAD")) return false;
    const relative = staticRelativePath(pathname);
    if (!relative || fileUnder(own, relative)) return false;
    for (const release of releases) {
      const path = fileUnder(release.dir, relative);
      if (!path) continue;
      const ext = extname(path).toLowerCase();
      const headers = {
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": BINARY.has(ext)
          ? "public, max-age=31536000, immutable, no-transform"
          : "public, max-age=31536000, immutable",
        "X-Tiao-Release-Asset": release.sha,
      };
      if (!BINARY.has(ext)) headers["Content-Length"] = statSync(path).size;
      res.writeHead(200, headers);
      if (req.method === "HEAD") res.end();
      else createReadStream(path).pipe(res);
      return true;
    }
    return false;
  }

  /** True for a router/action request issued by a tab of a different release. */
  function isForeignFlight(req) {
    const foreign = req.headers["x-deployment-id"];
    if (!deploymentId || typeof foreign !== "string" || foreign === deploymentId) return false;
    return (
      req.headers.rsc === "1" ||
      req.headers["next-router-prefetch"] !== undefined ||
      req.headers["next-action"] !== undefined
    );
  }

  function refuseForeignFlight(res) {
    res.writeHead(409, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end("Release changed; load the page again.");
  }

  return { serve, isForeignFlight, refuseForeignFlight, releases: releases.map((row) => row.sha) };
}
