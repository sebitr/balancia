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
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          root: rootDir,
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integration.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          root: rootDir,
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./tests/setup/components.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          root: rootDir,
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
