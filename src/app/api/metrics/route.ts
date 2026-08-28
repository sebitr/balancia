import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { registerRuntimeMetrics } from "@/lib/metrics/metrics";
import { getRegistry } from "@/lib/metrics/registry";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Prometheus metrics, for the operator of this installation.
 *
 * Local, exact, and never transmitted by Balancia: the only way these numbers
 * leave the server is an operator pointing their own scraper at this path.
 * They are not telemetry and share none of its code.
 *
 * Off by default. When switched on it answers only over the app's own port —
 * which `compose.yaml` publishes, so an instance on the public internet would
 * otherwise be handing its request rates to anyone who asked. Hence
 * `METRICS_TOKEN`: set it unless the port is on a private network. Without the
 * variable *and* without such a network, this is readable by strangers, which
 * is why the absence of both is logged loudly at startup of the route.
 */
export const dynamic = "force-dynamic";

/**
 * Constant-time comparison that does not leak the token's length by timing.
 *
 * `timingSafeEqual` throws on mismatched lengths, so comparing the tokens
 * directly means returning early whenever the lengths differ — which answers
 * "how long is the token?" in the one dimension the function exists to close.
 * Hashing first makes both sides 32 bytes whatever went in, so the comparison
 * runs the same way every time and the only thing timing reveals is that a
 * request was made.
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest): Promise<Response> {
  return trackRoute("/api/metrics", "GET", () => handleGet(request));
}

async function handleGet(request: NextRequest): Promise<Response> {
  const env = getEnv();
  if (!env.METRICS_ENABLED) {
    // 404 rather than 403: an instance that does not expose metrics should not
    // confirm that the endpoint would exist if it did.
    return new NextResponse("Not found", { status: 404 });
  }

  if (env.METRICS_TOKEN) {
    const header = request.headers.get("authorization") ?? "";
    const provided = header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : "";
    if (!provided || !tokenMatches(provided, env.METRICS_TOKEN)) {
      return new NextResponse("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      });
    }
  }

  registerRuntimeMetrics();

  return new NextResponse(getRegistry().render(), {
    headers: {
      // The version Prometheus's text format has carried since 0.0.4.
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
