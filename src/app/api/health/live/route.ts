import { NextResponse } from "next/server";

/**
 * Liveness: is the process running and able to serve a request?
 *
 * Deliberately does not touch PostgreSQL — a database outage should not cause
 * the orchestrator to kill and restart a perfectly healthy web process.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
