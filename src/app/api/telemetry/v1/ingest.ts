import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { MAX_PAYLOAD_BYTES } from "@/lib/telemetry/schema";
import { ingestReport } from "@/lib/telemetry/receiver";

/**
 * Everything both collector endpoints do before a payload reaches validation.
 *
 * The shape of this file is defensive on purpose: it is the one place in
 * Balancia that accepts a request from a stranger with no account, no session
 * and no invitation.
 *
 *  1. **404 unless this deployment is a collector.** Not 403: an instance that
 *     is not collecting should not advertise that the route exists.
 *  2. **A size limit before the body is read.** `Content-Length` first, then
 *     the actual bytes, because a chunked request declares nothing.
 *  3. **A content type.** `application/json` and nothing else.
 *  4. **A rate limit that stores no address.** See `limitKey` below.
 *  5. **Nothing about the request is recorded.** No address, no headers, no
 *     user agent, no arrival time finer than the UTC day. The response says
 *     only whether the payload was accepted.
 *
 * Note what is deliberately *not* here: authentication. A report carries no
 * identity by design, so there is no account to tie a credential to, and a
 * shared secret in every copy of an open-source application is not a
 * credential. The protections against abuse are the size limit, the rate
 * limit, the strict schema, and the fact that an accepted report is a row in a
 * table that is folded to counts and deleted.
 */

export type IngestKind = "usage" | "crash";

function notFound(): NextResponse {
  return new NextResponse("Not found", { status: 404 });
}

/**
 * The rate-limit key for a request, which is not the address.
 *
 * A collector still has to stop one source from flooding it, and doing that
 * per-source means deriving *something* from the address. What is stored is an
 * HMAC of the address under this instance's secret, salted with the UTC day —
 * so a key cannot be compared against yesterday's, and the rows themselves are
 * swept within 24 hours by the maintenance job.
 *
 * This is a pseudonym, not anonymity, and the documentation says so: somebody
 * holding both the database and `AUTH_SECRET` could confirm a guessed address
 * by recomputing the hash. What they cannot do is read an address out of the
 * table, and no analytics data is ever joined to this value — it lives in
 * `rate_limits` and is never seen by the reports.
 */
function limitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const address =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";

  const day = new Date().toISOString().slice(0, 10);
  return createHmac("sha256", getEnv().AUTH_SECRET)
    .update(`${day}:${address}`)
    .digest("hex")
    .slice(0, 32);
}

export async function ingest(
  kind: IngestKind,
  request: NextRequest,
): Promise<NextResponse> {
  if (!getEnv().TELEMETRY_RECEIVER) return notFound();

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: "content-type must be application/json" },
      { status: 415 },
    );
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const limit = await consumeRateLimit("telemetryIngest", limitKey(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "too many reports" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return NextResponse.json({ error: "unreadable body" }, { status: 400 });
  }

  // A chunked request declares no length, so the real bound is here.
  if (Buffer.byteLength(body, "utf8") > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const outcome = await ingestReport(kind, payload);
  if (!outcome.ok) {
    // Counted, never quoted: knowing that reports are being rejected is
    // operationally useful; the payload that was rejected is not this
    // collector's to keep.
    logger.info({ kind, reason: outcome.error }, "Telemetry report rejected");
    return NextResponse.json(
      { error: outcome.error },
      { status: outcome.status },
    );
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
