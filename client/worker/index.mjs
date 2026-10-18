/**
 * The Worker in front of playtiao.com's dynamic routes.
 *
 * wrangler.jsonc sends only `/game/<id>`, `/profile/<name>`,
 * `/tournament/<id>` and `/embed/game/<id>` (and their `.txt` RSC payloads,
 * with or without a /de or /es prefix) here; every other request is a
 * static asset that never invokes this code. For each one it serves the
 * route's `__spa__` placeholder file, and for a page writes that link's
 * title, description and preview image into it, from the public API.
 * Each request handled here counts toward the Workers request limit.
 */

import {
  DEFAULT_LOCALE,
  LOCALES,
  pageUrl,
  parseDynamicPath,
  placeholderPath,
  previewDataPath,
  previewFor,
} from "./previews.mjs";

const API_TIMEOUT_MS = 1500;

const escapeAttribute = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

async function previewData(env, parsed) {
  const path = previewDataPath(parsed.route, parsed.id);
  if (!path) return null;
  try {
    const response = await fetch(new URL(path, env.API_ORIGIN), {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function setContent(value) {
  return {
    element(element) {
      element.setAttribute("content", value);
    },
  };
}

function rewrite(response, parsed, preview) {
  const links = [
    `<link rel="canonical" href="${escapeAttribute(pageUrl(parsed.locale, parsed.route, parsed.id))}"/>`,
    ...LOCALES.map(
      (locale) =>
        `<link rel="alternate" hrefLang="${locale}" href="${escapeAttribute(pageUrl(locale, parsed.route, parsed.id))}"/>`,
    ),
    `<link rel="alternate" hrefLang="x-default" href="${escapeAttribute(pageUrl(DEFAULT_LOCALE, parsed.route, parsed.id))}"/>`,
    `<meta property="og:url" content="${escapeAttribute(pageUrl(parsed.locale, parsed.route, parsed.id))}"/>`,
  ].join("");
  const rewritten = new HTMLRewriter()
    .on("title", {
      element(element) {
        element.setInnerContent(`${preview.title} | Tiao`);
      },
    })
    .on('meta[name="description"]', setContent(preview.description))
    .on('meta[property="og:title"]', setContent(preview.title))
    .on('meta[property="og:description"]', setContent(preview.socialDescription))
    .on('meta[property="og:image"]', setContent(preview.image))
    .on('meta[name="twitter:title"]', setContent(preview.title))
    .on('meta[name="twitter:description"]', setContent(preview.description))
    .on('meta[name="twitter:image"]', setContent(preview.image))
    .on("head", {
      element(element) {
        element.append(links, { html: true });
      },
    })
    .transform(response);
  // One placeholder file, many pages: its validators would be wrong here.
  const headers = new Headers(rewritten.headers);
  headers.delete("ETag");
  headers.delete("Last-Modified");
  return new Response(rewritten.body, { status: rewritten.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parsed = parseDynamicPath(url.pathname);
    if (!parsed || (request.method !== "GET" && request.method !== "HEAD")) {
      return env.ASSETS.fetch(request);
    }
    const asset = await env.ASSETS.fetch(
      new Request(new URL(placeholderPath(parsed), url), request),
    );
    if (parsed.payload || request.method === "HEAD" || !asset.ok || parsed.route === "embed/game") {
      return asset;
    }
    const preview = previewFor(parsed, await previewData(env, parsed));
    return preview ? rewrite(asset, parsed, preview) : asset;
  },
};
