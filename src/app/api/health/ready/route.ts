import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { logger } from "@/lib/logger";

/**
 * Readiness: can this process actually serve traffic?
 *
 * Checks that PostgreSQL answers and that migrations have been applied — a
 * container that starts before the migration job finishes must not be sent
 * traffic.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const result = await db.execute(
      sql`SELECT count(*)::int AS applied FROM "__balancia_migrations"`,
    );
    const applied = Number(
      (result.rows[0] as { applied?: number } | undefined)?.applied ?? 0,
    );

    if (applied === 0) {
      return NextResponse.json(
        { status: "starting", reason: "migrations-not-applied" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { status: "ok", migrations: applied },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "Readiness check failed",
    );
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
