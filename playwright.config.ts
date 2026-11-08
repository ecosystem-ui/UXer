import { defineConfig } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8099',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // Build the client, wipe the isolated DB, build a standalone server binary
    // and run it. `exec` replaces the shell so Playwright kills the server
    // directly (no orphaned `go run` child holding a wiped DB). Everything runs
    // before the server opens the DB, so ordering is deterministic.
    command:
      'cd ../client && npm run build && cd ../server && rm -f data/e2e.db data/e2e.db-wal data/e2e.db-shm && mkdir -p bin && go build -o bin/uxer-e2e ./cmd/uxer && exec ./bin/uxer-e2e',
    cwd: path.join(process.cwd(), 'server'),
    url: 'http://localhost:8099/api/auth/me',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      UXER_PORT: '8099',
      UXER_DB_PATH: 'data/e2e.db',
      UXER_STATIC_DIR: '../client/dist',
      SESSION_SECRET: 'e2e-test-secret-0123456789abcdef0123456789abcdef',
      ALLOW_PRIVATE_HOSTS: 'localhost,127.0.0.1',
      // The suite signs up many users from one IP; keep the limiter out of the way.
      UXER_AUTH_RATE_LIMIT: '500',
    },
  },
});
