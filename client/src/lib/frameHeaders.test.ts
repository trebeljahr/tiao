import { describe, expect, it } from "vitest";
import {
  FRAME_ALLOW_HEADERS,
  FRAME_DENY_HEADERS,
  frameHeadersFor,
  isEmbedPath,
} from "./frameHeaders";

describe("isEmbedPath", () => {
  it("matches embed routes with and without a locale prefix", () => {
    expect(isEmbedPath("/embed/game/ABC123")).toBe(true);
    expect(isEmbedPath("/de/embed/game/ABC123")).toBe(true);
    expect(isEmbedPath("/es/embed/game/ABC123")).toBe(true);
    expect(isEmbedPath("/embed")).toBe(true);
  });

  it("rejects everything else, including look-alikes", () => {
    expect(isEmbedPath("/")).toBe(false);
    expect(isEmbedPath("/game/ABC123")).toBe(false);
    expect(isEmbedPath("/de/game/ABC123")).toBe(false);
    expect(isEmbedPath("/embedded/game/ABC123")).toBe(false);
    expect(isEmbedPath("/games?next=/embed/game/ABC123")).toBe(false);
    expect(isEmbedPath("/fr/embed/game/ABC123")).toBe(false);
    expect(isEmbedPath("/profile/embed")).toBe(false);
  });
});

describe("frameHeadersFor", () => {
  it("denies framing for regular routes", () => {
    expect(frameHeadersFor("/games")).toBe(FRAME_DENY_HEADERS);
    expect(FRAME_DENY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(FRAME_DENY_HEADERS["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
  });

  it("allows any ancestor for embed routes and sets no X-Frame-Options", () => {
    const headers = frameHeadersFor("/embed/game/ABC123");
    expect(headers).toBe(FRAME_ALLOW_HEADERS);
    expect(headers["Content-Security-Policy"]).toBe("frame-ancestors *");
    expect("X-Frame-Options" in headers).toBe(false);
  });
});
