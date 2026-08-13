import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the critical browser journeys.
 *
 * The suite runs against a real production build with a real PostgreSQL, so it
 * exercises the same code path a self-hoster runs — not a dev-mode
 * approximation.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Financial state is shared through one database; keep runs serial.
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
      // The responsive suite belongs to the mobile project.
      testIgnore: /responsive\.spec\.ts/,
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      testMatch: /responsive\.spec\.ts/,
    },
  ],

  webServer: {
    command: `pnpm start --port ${PORT}`,
    url: `${baseURL}/api/health/ready`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      PORT: String(PORT),
      APP_URL: baseURL,
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ??
        process.env.DATABASE_URL ??
        "postgres://balancia:balancia@127.0.0.1:5432/balancia_e2e",
      AUTH_SECRET:
        process.env.AUTH_SECRET ??
        "e2e-only-secret-0123456789abcdef0123456789abcdef",
      STORAGE_LOCAL_PATH: "./data/e2e-uploads",
      LOG_LEVEL: "warn",
      // Every request in the suite comes from one address; the per-IP auth
      // limit would otherwise trip partway through a run.
      AUTH_RATE_LIMIT_MAX: "100000",
    },
  },
});
