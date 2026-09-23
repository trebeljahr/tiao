import { describe, expect, it } from "vitest";
import {
  buildEmbedCode,
  buildEmbedPath,
  buildEmbedUrl,
  EMBED_DEFAULT_HEIGHT,
  EMBED_DEFAULT_WIDTH,
  escapeHtmlAttribute,
} from "./embed";

describe("buildEmbedPath", () => {
  it("uses the unprefixed path for the default locale", () => {
    expect(buildEmbedPath("ABC123")).toBe("/embed/game/ABC123");
    expect(buildEmbedPath("ABC123", "en")).toBe("/embed/game/ABC123");
  });

  it("prefixes non-default locales", () => {
    expect(buildEmbedPath("ABC123", "de")).toBe("/de/embed/game/ABC123");
    expect(buildEmbedPath("ABC123", "es", "en")).toBe("/es/embed/game/ABC123");
  });

  it("normalises the game id to upper case and encodes it", () => {
    expect(buildEmbedPath(" abc123 ")).toBe("/embed/game/ABC123");
    expect(buildEmbedPath("a b")).toBe("/embed/game/A%20B");
  });
});

describe("buildEmbedUrl", () => {
  it("joins origin and path, stripping trailing slashes", () => {
    expect(buildEmbedUrl({ origin: "https://playtiao.com/", gameId: "ABC123" })).toBe(
      "https://playtiao.com/embed/game/ABC123",
    );
    expect(buildEmbedUrl({ origin: "http://localhost:3100", gameId: "ABC123", locale: "de" })).toBe(
      "http://localhost:3100/de/embed/game/ABC123",
    );
  });
});

describe("escapeHtmlAttribute", () => {
  it("escapes the characters that can break out of a quoted attribute", () => {
    expect(escapeHtmlAttribute('a"b<c>d&e')).toBe("a&quot;b&lt;c&gt;d&amp;e");
  });
});

describe("buildEmbedCode", () => {
  it("produces an iframe with src, default size, title and lazy loading", () => {
    const code = buildEmbedCode({ origin: "https://playtiao.com", gameId: "ABC123" });
    expect(code).toBe(
      `<iframe src="https://playtiao.com/embed/game/ABC123" width="${EMBED_DEFAULT_WIDTH}" height="${EMBED_DEFAULT_HEIGHT}" title="Tiao game ABC123" frameborder="0" loading="lazy"></iframe>`,
    );
  });

  it("honours explicit dimensions and rounds them", () => {
    const code = buildEmbedCode({
      origin: "https://playtiao.com",
      gameId: "ABC123",
      width: 320.4,
      height: 400.6,
    });
    expect(code).toContain('width="320"');
    expect(code).toContain('height="401"');
  });

  it("falls back to defaults for invalid dimensions", () => {
    const code = buildEmbedCode({
      origin: "https://playtiao.com",
      gameId: "ABC123",
      width: -1,
      height: Number.NaN,
    });
    expect(code).toContain(`width="${EMBED_DEFAULT_WIDTH}"`);
    expect(code).toContain(`height="${EMBED_DEFAULT_HEIGHT}"`);
  });

  it("includes the locale prefix in the src", () => {
    const code = buildEmbedCode({ origin: "https://playtiao.com", gameId: "ABC123", locale: "es" });
    expect(code).toContain('src="https://playtiao.com/es/embed/game/ABC123"');
  });

  it("never lets a hostile game id break out of the src attribute", () => {
    const code = buildEmbedCode({ origin: "https://playtiao.com", gameId: '"><script>' });
    expect(code).not.toContain("<script>");
    expect(code.match(/<iframe /g)).toHaveLength(1);
    expect(code.match(/<\/iframe>/g)).toHaveLength(1);
  });
});
