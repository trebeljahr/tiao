import { describe, expect, it } from "vitest";
import { DESKTOP_SPA_PARAM_VALUE, resolveDynamicParam } from "./desktopPathParam";

const SPA = DESKTOP_SPA_PARAM_VALUE;

describe("resolveDynamicParam", () => {
  it("passes a real (web) value through unchanged, whatever the URL", () => {
    expect(resolveDynamicParam("game", "ABC123", "/en/game/OTHER/")).toBe("ABC123");
    expect(resolveDynamicParam("game", undefined, "/en/game/OTHER/")).toBeUndefined();
  });

  it("reads the real value from the path behind a placeholder page (desktop and mobile)", () => {
    expect(resolveDynamicParam("game", SPA, "/en/game/ABC123/")).toBe("ABC123");
    expect(resolveDynamicParam("profile", SPA, "/de/profile/rico")).toBe("rico");
    expect(resolveDynamicParam("tournament", SPA, "/es/tournament/T42/")).toBe("T42");
    expect(resolveDynamicParam("game", SPA, "/en/embed/game/XYZ/")).toBe("XYZ");
  });

  it("decodes percent-escaped values", () => {
    expect(resolveDynamicParam("profile", SPA, "/en/profile/J%C3%BCrgen/")).toBe("Jürgen");
    expect(resolveDynamicParam("profile", SPA, "/en/profile/%E0%A4%A/")).toBeUndefined();
  });

  it("returns undefined when the path names no real value", () => {
    expect(resolveDynamicParam("game", SPA, "/en/game/")).toBeUndefined();
    expect(resolveDynamicParam("game", SPA, `/en/game/${SPA}/`)).toBeUndefined();
    expect(resolveDynamicParam("game", SPA, "/en/play/")).toBeUndefined();
    expect(resolveDynamicParam("game", SPA, null)).toBe(
      resolveDynamicParam("game", SPA, window.location.pathname),
    );
  });

  it("falls back to window.location when no pathname is given", () => {
    window.history.replaceState(null, "", "/en/game/LIVE42/");
    try {
      expect(resolveDynamicParam("game", SPA)).toBe("LIVE42");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});
