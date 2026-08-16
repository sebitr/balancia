import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, getCurrentActor } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";
import { UnknownCurrencyError } from "@/modules/currencies/iso-4217";
import { lookupRate } from "@/modules/currencies/rates";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Exchange-rate suggestion for the expense, settlement and recurring forms.
 *
 * Deliberately not group-scoped: a published reference rate is not anyone's
 * data, so the only access rule is that a caller be a participant of *some*
 * kind — a signed-in user or a guest with a live session. That, plus a rate
 * limit, keeps the instance from being used as an anonymous proxy to the
 * upstream provider.
 *
 * Answers 200 with `rate: null` when there is no suggestion to make (provider
 * off, currency unsupported, provider unreachable). The form treats that as
 * "type it in", which is the pre-provider behaviour.
 */

const querySchema = z.object({
  from: z.string().regex(/^[A-Z]{3}$/, "from must be an ISO 4217 code"),
  to: z.string().regex(/^[A-Z]{3}$/, "to must be an ISO 4217 code"),
  on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "on must be a YYYY-MM-DD date"),
});

export async function GET(request: Request) {
  return trackRoute("/api/rates", "GET", () => handleGet(request));
}

async function handleGet(request: Request) {
  const actor = await getCurrentActor();
  if (!actor) {
    return NextResponse.json(
      { error: "Sign in to continue." },
      { status: 401 },
    );
  }

  const limit = await consumeRateLimit("rateLookup", await getClientIp());
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many rate lookups. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    on: url.searchParams.get("on") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  if (parsed.data.from === parsed.data.to) {
    return NextResponse.json(
      { error: "A rate needs two different currencies." },
      { status: 400 },
    );
  }

  try {
    const quote = await lookupRate(parsed.data);
    return NextResponse.json(
      quote ?? { rate: null },
      // A suggestion is cheap to recompute and must never be served to the
      // wrong person from a shared cache.
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof UnknownCurrencyError) {
      return NextResponse.json(
        { error: "Unsupported currency." },
        { status: 400 },
      );
    }
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Rate lookup failed",
    );
    return NextResponse.json(
      { error: "The rate could not be looked up." },
      { status: 500 },
    );
  }
}
