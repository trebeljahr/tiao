import { describe, expect, it, vi } from "vitest";
import {
  deepLinkToPath,
  dispatchAuthDeepLink,
  isAuthDeepLink,
  onAuthDeepLink,
} from "./nativeDeepLinks";

describe("deepLinkToPath", () => {
  it("maps tiao:// links to in-app pages", () => {
    expect(deepLinkToPath("tiao://game/ABC123")).toBe("/game/ABC123/");
    expect(deepLinkToPath("tiao://de/profile/rico")).toBe("/de/profile/rico/");
    expect(deepLinkToPath("tiao://tournament/T42?tab=bracket")).toBe(
      "/tournament/T42/?tab=bracket",
    );
  });

  it("maps playtiao.com links and keeps the locale", () => {
    expect(deepLinkToPath("https://playtiao.com/es/game/X1")).toBe("/es/game/X1/");
    expect(deepLinkToPath("https://www.playtiao.com/")).toBe("/");
  });

  it("keeps the user's current locale for links without one", () => {
    expect(deepLinkToPath("tiao://game/ABC", "/de/play/")).toBe("/de/game/ABC/");
    expect(deepLinkToPath("tiao://game/ABC", "/play/")).toBe("/game/ABC/");
  });

  it("ignores auth returns, foreign hosts, traversal and junk", () => {
    expect(deepLinkToPath("tiao://auth/complete?code=1")).toBeNull();
    expect(deepLinkToPath("https://evil.example/game/1")).toBeNull();
    expect(deepLinkToPath("http://playtiao.com/game/1")).toBeNull();
    expect(deepLinkToPath("tiao://game/../../etc")).not.toContain("..");
    expect(deepLinkToPath("not a url")).toBeNull();
  });
});

describe("auth deep links", () => {
  it("are recognised and replayed to a late subscriber exactly once", () => {
    expect(isAuthDeepLink("tiao://auth/complete")).toBe(true);
    expect(isAuthDeepLink("tiao://game/1")).toBe(false);
    dispatchAuthDeepLink("tiao://auth/complete?state=cold");
    const listener = vi.fn();
    const stop = onAuthDeepLink(listener);
    expect(listener).toHaveBeenCalledWith("tiao://auth/complete?state=cold");
    dispatchAuthDeepLink("tiao://auth/complete?state=warm");
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    const later = vi.fn();
    onAuthDeepLink(later)();
    expect(later).not.toHaveBeenCalled();
  });
});
