import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` is a bundler-time guard that throws under plain Node.
      // Tests exercise the server code directly, so point it at a no-op.
      "server-only": fileURLToPath(
        new URL("./scripts/server-only-noop.js", import.meta.url),
      ),
    },
  },
  test: {
    root: rootDir,
    globals: true,
    // Each inline project inherits everything above — the React plugin, the
    // aliases, `root`, `globals` — and shares one Vite server with the others.
    // Setting `root`, `alias` or a plugin inside a project gives it a server of
    // its own, so those belong up here.
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integration.test.ts"],
        },
      },
      {
        test: {
          name: "components",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./tests/setup/components.ts"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: [
            "tests/integration/**/*.test.ts",
            "src/**/*.integration.test.ts",
          ],
          globalSetup: ["./tests/setup/database.global.ts"],
          setupFiles: ["./tests/setup/integration.ts"],
          // Database tests share one PostgreSQL instance; run files serially
          // so schema-level operations do not race.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/modules/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "src/lib/db/schema/**"],
    },
  },
});
