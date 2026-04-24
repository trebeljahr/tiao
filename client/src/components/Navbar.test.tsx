import { describe, expect, it } from "vitest";

describe("Navbar build version", () => {
  it("APP_VERSION includes build number and commit hash", () => {
    // In Next.js, next.config.mjs injects APP_VERSION via the env config.
    // In vitest, the define in vitest.config.mts replicates this.
    // This test guards against the regression where the version string
    // lost its build number during the Vite-to-Next.js migration (#70).
    const version = process.env.APP_VERSION;
    expect(version).toBeDefined();
    expect(version).toMatch(/^\d+\.\d+\.\d+-build\.\d+\+[a-f0-9]+$/);
  });
});
