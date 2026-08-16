import type { NextRequest } from "next/server";
import { ingest } from "../ingest";
import { trackRoute } from "@/lib/metrics/http";

/**
 * `POST /v1/crash` — the collector's endpoint for anonymous crash
 * classifications.
 *
 * Separate route from the usage report because it is a separate opt-in at the
 * sending end, and because the two payloads have nothing in common but a
 * schema number.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  return trackRoute("/api/telemetry/v1/crash", "POST", () =>
    handlePost(request),
  );
}

async function handlePost(request: NextRequest): Promise<Response> {
  return ingest("crash", request);
}
