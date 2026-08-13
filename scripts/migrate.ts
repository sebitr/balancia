/**
 * Applies committed SQL migrations. Run as the Compose `migrate` service
 * before the app and worker start, and locally via `pnpm db:migrate`.
 */
import { runMigrations } from "@/lib/db/migrate";
import { logger } from "@/lib/logger";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const result = await runMigrations({ databaseUrl });
  logger.info(
    { applied: result.applied, skippedCount: result.skipped.length },
    result.applied.length > 0
      ? `Applied ${result.applied.length} migration(s)`
      : "Database is already up to date",
  );
}

main().catch((error: unknown) => {
  logger.error(
    { err: error instanceof Error ? error.message : String(error) },
    "Migration failed",
  );
  process.exitCode = 1;
});
