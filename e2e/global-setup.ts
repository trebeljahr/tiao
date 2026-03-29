import { cleanDatabase, closeDbConnection } from "./db-utils";

async function globalSetup(): Promise<void> {
  // Clean the e2e database before each test suite run so tests don't
  // trip over stale data from previous runs (the Docker containers
  // now persist between runs for faster startup).
  try {
    await cleanDatabase();
  } catch {
    // DB might not be up yet — start-server.sh will bring it up
  } finally {
    await closeDbConnection();
  }
}

export default globalSetup;
