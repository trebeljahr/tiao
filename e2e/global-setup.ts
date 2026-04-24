import { execSync } from "node:child_process";
import { cleanDatabase, closeDbConnection } from "./db-utils";

async function globalSetup(): Promise<void> {
  // Clean the e2e database and Redis before each test suite run so tests
  // don't trip over stale data from previous runs (Docker containers
  // persist between runs for faster startup).
  try {
    await cleanDatabase();
  } catch {
    // DB might not be up yet — start-server.sh will bring it up
  } finally {
    await closeDbConnection();
  }

  // Flush the e2e Redis instance (clears matchmaking queue, rate limits, etc.)
  try {
    execSync("docker exec tiao-e2e-redis redis-cli FLUSHDB", { stdio: "ignore" });
  } catch {
    // Redis container might not be up yet
  }
}

export default globalSetup;
