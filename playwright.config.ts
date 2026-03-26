import { defineConfig, devices } from '@playwright/test';

const E2E_MONGO_URI = 'mongodb://127.0.0.1:27018/tiao-e2e';
const E2E_SERVER_PORT = '5006';
const E2E_CLIENT_PORT = '3001';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${E2E_CLIENT_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'bash e2e/start-server.sh',
      url: `http://localhost:${E2E_SERVER_PORT}/api/player/me`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        MONGODB_URI: E2E_MONGO_URI,
        TOKEN_SECRET: 'e2e-secret',
        PORT: E2E_SERVER_PORT,
      },
    },
    {
      command: 'npm run client',
      url: `http://localhost:${E2E_CLIENT_PORT}`,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: E2E_CLIENT_PORT,
        API_PORT: E2E_SERVER_PORT,
      },
    }
  ],
});
