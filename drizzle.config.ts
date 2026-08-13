import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration.
 *
 * Migrations are generated locally (`pnpm db:generate`), reviewed, and
 * committed. Production applies committed SQL through the `migrate` service —
 * `drizzle-kit push` is never used against a real deployment.
 */
export default defineConfig({
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://balancia:balancia@localhost:5432/balancia",
  },
  strict: true,
  verbose: true,
});
