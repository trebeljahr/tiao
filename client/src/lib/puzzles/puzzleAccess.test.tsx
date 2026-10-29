import { afterEach, describe, expect, it, vi } from "vitest";
import LearningPage from "../../../app/[locale]/learn/page.dev";
import PuzzlePage from "../../../app/[locale]/puzzles/page.dev";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/views/PuzzlesPage", () => ({ PuzzlesPage: () => null }));
vi.mock("@/views/LearningPage", () => ({ LearningPage: () => null }));

afterEach(() => vi.unstubAllEnvs());

describe.each([
  ["puzzles", PuzzlePage],
  ["learn", LearningPage],
])("%s route environment gate", (_name, Page) => {
  it("loads only in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await Page()).toBeTruthy();
  });
  for (const environment of ["production", "test"]) {
    it(`rejects direct access in ${environment}`, async () => {
      vi.stubEnv("NODE_ENV", environment);
      await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    });
  }
});
