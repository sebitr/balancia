import { NextResponse } from "next/server";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Liveness: is the process running and able to serve a request?
 *
 * Deliberately does not touch PostgreSQL — a database outage should not cause
 * the orchestrator to kill and restart a perfectly healthy web process.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return trackRoute("/api/health/live", "GET", () => handleGet());
}

async function handleGet() {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
