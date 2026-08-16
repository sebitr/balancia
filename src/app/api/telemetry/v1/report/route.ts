import type { NextRequest } from "next/server";
import { ingest } from "../ingest";
import { trackRoute } from "@/lib/metrics/http";

/**
 * `POST /v1/report` — the collector's endpoint for anonymous usage reports.
 *
 * Exists only where `TELEMETRY_RECEIVER=true`; everywhere else it answers 404,
 * which is every self-hosted installation. See `../ingest.ts` for what it
 * accepts and what it refuses.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  return trackRoute("/api/telemetry/v1/report", "POST", () =>
    handlePost(request),
  );
}

async function handlePost(request: NextRequest): Promise<Response> {
  return ingest("usage", request);
}
