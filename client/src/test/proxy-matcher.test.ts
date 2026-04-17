import { describe, it, expect } from "vitest";
import { config } from "../../proxy";

// The matcher is a Next.js PathToRegexp pattern: a single string prefixed
// with "/". Next compiles it like `new RegExp("^" + pattern + "$")`. We
// mimic that here so the tests run against the actual exported pattern,
// not a copy — any edit to proxy.ts's matcher must keep these invariants.
function matches(pathname: string): boolean {
  const pattern = config.matcher[0];
  return new RegExp("^" + pattern + "$").test(pathname);
}

describe("next-intl middleware matcher (proxy.ts)", () => {
  it("runs for regular app routes", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/game/ABCDEF")).toBe(true);
    expect(matches("/profile/rico")).toBe(true);
    expect(matches("/de")).toBe(true);
    expect(matches("/de/games")).toBe(true);
  });

  it("skips backend proxied paths", () => {
    // api + ws are handled by server.mjs and must never be locale-rewritten.
    expect(matches("/api/games")).toBe(false);
    expect(matches("/api/auth/sign-in")).toBe(false);
    expect(matches("/ws/lobby")).toBe(false);
  });

  it("skips Next.js / Vercel internals", () => {
    expect(matches("/_next/static/chunks/main.js")).toBe(false);
    expect(matches("/_vercel/insights/view")).toBe(false);
  });

  it("skips analytics + error-monitoring infra paths (regression #160)", () => {
    // /collect/track (OpenPanel) and /bugs (GlitchTip tunnel) are reverse-
    // proxied by server.mjs when OPENPANEL_PROXY_URL / GLITCHTIP_PROXY_URL
    // are set. The next-intl middleware must NEVER touch them — otherwise,
    // in the missing-env-var failure mode or any race, the path gets
    // rewritten to /<locale>/collect/track (404) and every tracked event
    // or reported error becomes a console error for the user.
    expect(matches("/collect/track")).toBe(false);
    expect(matches("/collect/screen_view")).toBe(false);
    expect(matches("/bugs")).toBe(false);
  });

  it("skips static assets (paths with a dot)", () => {
    // /sw.js is the motivating case — service workers must be served
    // verbatim from public/, never locale-rewritten. The generic
    // ".*\\..*" clause covers this plus favicon, images, robots.txt, etc.
    expect(matches("/sw.js")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
    expect(matches("/robots.txt")).toBe(false);
    expect(matches("/og/game.png")).toBe(false);
  });
});
