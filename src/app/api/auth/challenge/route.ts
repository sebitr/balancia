import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  issueProofOfWork,
  proofOfWorkEnabled,
} from "@/lib/security/proof-of-work";
import { trackRoute } from "@/lib/metrics/http";

/**
 * The puzzle a client solves before it may create an account.
 *
 * Unauthenticated by definition — it is asked for by somebody who has no
 * account yet — and it answers whether the instance wants one at all, so a
 * client has exactly one code path either way: ask, and send back an answer if
 * there was a question. That is why `enabled: false` is a 200 and not a 404.
 * The register form does not have to know how this instance is configured, and
 * a native client built against an instance that later switches this on keeps
 * working.
 *
 * Issuing writes a row, so it is rate limited like everything else that does.
 * The bucket is generous: a form that is opened, abandoned and reopened should
 * never meet it.
 */
export async function GET() {
  return trackRoute("/api/auth/challenge", "GET", handle);
}

async function handle() {
  if (!proofOfWorkEnabled()) {
    return NextResponse.json(
      { enabled: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const limit = await consumeRateLimit("proofOfWork", await getClientIp());
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(limit.retryAfterSeconds),
        },
      },
    );
  }

  const challenge = await issueProofOfWork();
  return NextResponse.json(
    { enabled: true, ...challenge },
    { headers: { "Cache-Control": "no-store" } },
  );
}
