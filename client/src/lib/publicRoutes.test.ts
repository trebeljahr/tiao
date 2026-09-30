import { describe, expect, it } from "vitest";
import { isPublicInfoPath } from "./publicRoutes";

describe("public information routes", () => {
  it.each([
    "/",
    "/en",
    "/de/",
    "/es/rules",
    "/rules/",
  ])("does not need a lobby session: %s", (path) => {
    expect(isPublicInfoPath(path)).toBe(true);
  });
  it.each([
    "/play",
    "/de/play",
    "/game/123",
    "/rules/unknown",
    "/es/friends",
  ])("keeps app services available: %s", (path) => {
    expect(isPublicInfoPath(path)).toBe(false);
  });
});
