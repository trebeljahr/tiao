import { execSync } from "node:child_process";

const CONTAINERS = ["tiao-e2e-mongo", "tiao-e2e-redis", "tiao-e2e-s3"];

async function globalTeardown(): Promise<void> {
  // In CI, services are managed externally (GitHub Actions service containers).
  // Locally, keep containers running so the next test run can reuse them
  // (matches reuseExistingServer: true in playwright.config.ts).
  // Set E2E_TEARDOWN=1 to force cleanup if you want a fresh slate.
  if (process.env.CI || !process.env.E2E_TEARDOWN) {
    return;
  }

  for (const container of CONTAINERS) {
    console.log(`Stopping ${container}...`);
    execSync(`docker rm -f ${container} 2>/dev/null || true`, {
      stdio: "inherit",
    });
  }

  console.log("E2E containers stopped.");
}

export default globalTeardown;
