import { execSync } from "child_process";

const CONTAINER_NAME = "tiao-e2e-mongo";

async function globalTeardown(): Promise<void> {
  if (process.env.CI) {
    return;
  }

  console.log("Stopping e2e MongoDB container...");
  execSync(`docker rm -f ${CONTAINER_NAME} 2>/dev/null || true`, {
    stdio: "inherit",
  });
  console.log("MongoDB container stopped.");
}

export default globalTeardown;
