import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { migrationNames, migrationsDirectory } from "@/lib/db/migrate";
import { reportedWorkerState } from "@/lib/jobs/worker-status";
import { logger } from "@/lib/logger";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Readiness: can this process actually serve traffic?
 *
 * Checks that PostgreSQL answers and that every migration this image carries
 * has been applied. A container that starts before the migration job finishes
 * must not be sent traffic, and neither must one whose code already expects a
 * column the database does not have yet — which is what an image rolled out
 * ahead of its migrations looks like under `RUN_MIGRATIONS=false`, and which
 * "at least one migration has run" used to wave through. The reverse is fine:
 * a database that has migrations this image does not know is an older image
 * on a newer schema, and migrations only ever add.
 *
 * It also says where the background worker stands, and deliberately does not
 * let that decide the status code. Readiness is what Compose's healthcheck and
 * a reverse proxy gate traffic on, and a web process whose worker is down
 * still serves every page correctly; failing it would turn a stalled queue
 * into an outage. The worker's state is in the body for a monitor to read,
 * and in `balancia_worker_up` for one that scrapes.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return trackRoute("/api/health/ready", "GET", () => handleGet());
}

/** Read once: the migrations are part of the image and never change under it. */
let bundled: readonly string[] | undefined;

function bundledMigrations(): readonly string[] {
  bundled ??= migrationNames(migrationsDirectory());
  return bundled;
}

async function handleGet() {
  const worker = reportedWorkerState();

  try {
    const db = getDb();
    const result = await db.execute(
      sql`SELECT name FROM "__balancia_migrations"`,
    );
    const applied = new Set(
      (result.rows as { name: string }[]).map((row) => row.name),
    );
    const pendingMigrations = bundledMigrations().filter(
      (name) => !applied.has(name),
    ).length;

    if (applied.size === 0 || pendingMigrations > 0) {
      return NextResponse.json(
        {
          status: "starting",
          reason: "migrations-not-applied",
          migrations: applied.size,
          pendingMigrations,
          worker,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { status: "ok", migrations: applied.size, pendingMigrations, worker },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.warn({ err: error }, "Readiness check failed");
    return NextResponse.json(
      { status: "unavailable", worker },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
