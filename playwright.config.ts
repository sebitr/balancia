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
    /*
     * The standalone server, which is what the Docker image runs — not
     * `next start`, which prints on every run that it "does not work with
     * output: standalone".
     *
     * `next build` leaves the two asset trees outside the bundle, so they are
     * staged in exactly as the Dockerfile copies them. Without that the app
     * boots and serves HTML with no CSS or icons behind it. The `rm` keeps a
     * second run from nesting `static/static`.
     */
    command: [
      "rm -rf .next/standalone/.next/static .next/standalone/public",
      "cp -r .next/static .next/standalone/.next/static",
      "cp -r public .next/standalone/public",
      "node .next/standalone/server.js",
    ].join(" && "),
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
      // The server under test serves pages and nothing else. On by default in
      // production, and it would have this run install pg-boss schedules
      // against the e2e database and sweep it between assertions.
      RUN_WORKER_IN_WEB: "false",
    },
  },
});
