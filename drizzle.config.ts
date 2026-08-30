// The .env files, before the config below reads DATABASE_URL out of the
// environment. drizzle-kit brings its own dotenv, which loads `.env` and stops
// there — so on a host that develops from `.env.local`, as docs/development.md
// says to, this would otherwise fall through to the default below and point at
// a different database than `pnpm db:migrate` just used.
import "./scripts/load-env";
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
