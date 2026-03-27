import { defineConfig, devices } from '@playwright/test';

const E2E_MONGO_URI = 'mongodb://127.0.0.1:27018/tiao-e2e';
const E2E_SERVER_PORT = '5006';
const E2E_CLIENT_PORT = '3001';
const E2E_REDIS_PORT = '6380';
const E2E_MINIO_PORT = '9002';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 3,
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
        NODE_ENV: 'test',
        MONGODB_URI: E2E_MONGO_URI,
        TOKEN_SECRET: 'e2e-secret',
        PORT: E2E_SERVER_PORT,
        REDIS_URL: `redis://localhost:${E2E_REDIS_PORT}`,
        S3_ENDPOINT: `http://localhost:${E2E_MINIO_PORT}`,
        S3_FORCE_PATH_STYLE: 'true',
        S3_BUCKET_NAME: 'tiao-e2e',
        S3_PUBLIC_URL: `http://localhost:${E2E_MINIO_PORT}/tiao-e2e`,
        AWS_ACCESS_KEY_ID: 'minioadmin',
        AWS_SECRET_ACCESS_KEY: 'minioadmin',
        AWS_REGION: 'us-east-1',
        FRONTEND_URL: `http://localhost:${E2E_CLIENT_PORT}`,
        E2E_MONGO_PORT: '27018',
        E2E_REDIS_PORT: E2E_REDIS_PORT,
        E2E_MINIO_PORT: E2E_MINIO_PORT,
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
