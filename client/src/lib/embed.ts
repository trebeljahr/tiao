/**
 * Builders for the embeddable finished-game widget.
 *
 * The `/embed/game/:gameId` route renders a finished game's board in
 * review mode with no navbar or footer, and is the only route the app
 * allows inside third-party iframes (see `src/lib/frameHeaders.ts`).
 * These helpers produce the URL and the `<iframe>` snippet the
 * "Copy embed code" button hands to the user.
 */

export const EMBED_DEFAULT_WIDTH = 480;
export const EMBED_DEFAULT_HEIGHT = 600;

/** Path segment that marks an embed route; shared with the frame-header logic. */
export const EMBED_PATH_SEGMENT = "embed";

export type EmbedCodeOptions = {
  /** Origin of the app, e.g. `https://playtiao.com` (no trailing slash). */
  origin: string;
  gameId: string;
  /**
   * Active UI locale. The default locale ("en") uses the unprefixed path
   * because next-intl runs with `localePrefix: "as-needed"`.
   */
  locale?: string;
  defaultLocale?: string;
  width?: number;
  height?: number;
};

export function buildEmbedPath(gameId: string, locale?: string, defaultLocale = "en"): string {
  const prefix = locale && locale !== defaultLocale ? `/${locale}` : "";
  return `${prefix}/${EMBED_PATH_SEGMENT}/game/${encodeURIComponent(gameId.trim().toUpperCase())}`;
}

export function buildEmbedUrl(
  options: Pick<EmbedCodeOptions, "origin" | "gameId" | "locale" | "defaultLocale">,
): string {
  const origin = options.origin.replace(/\/+$/, "");
  return `${origin}${buildEmbedPath(options.gameId, options.locale, options.defaultLocale)}`;
}

/** Escape a value for use inside a double-quoted HTML attribute. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toDimension(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.round(value);
}

/**
 * Build the `<iframe>` snippet for a finished game.
 *
 * Kept deliberately plain: fixed pixel width/height (so it renders the
 * same on every host page), no `allow` list (the widget needs no
 * permissions), and `loading="lazy"` so a blog post with several embeds
 * does not fetch every board up front.
 */
export function buildEmbedCode(options: EmbedCodeOptions): string {
  const src = buildEmbedUrl(options);
  const width = toDimension(options.width, EMBED_DEFAULT_WIDTH);
  const height = toDimension(options.height, EMBED_DEFAULT_HEIGHT);
  const title = `Tiao game ${options.gameId.trim().toUpperCase()}`;
  return (
    `<iframe src="${escapeHtmlAttribute(src)}" width="${width}" height="${height}" ` +
    `title="${escapeHtmlAttribute(title)}" frameborder="0" loading="lazy"></iframe>`
  );
}
