import { execSync } from "child_process";

const CONTAINERS = ["tiao-e2e-mongo", "tiao-e2e-redis", "tiao-e2e-minio"];

async function globalTeardown(): Promise<void> {
  if (process.env.CI) {
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
