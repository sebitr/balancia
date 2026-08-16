import { NextResponse } from "next/server";
import { headers } from "next/headers";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { getClientIp } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { AuthError } from "@/modules/auth/service";
import {
  finishPasskeyAuthentication,
  startPasskeyAuthentication,
} from "@/modules/auth/webauthn";
import { createSession } from "@/modules/auth/sessions";
import { setSessionCookie } from "@/modules/auth/cookies";
import { logger } from "@/lib/logger";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Passkey sign-in ceremony.
 *
 * GET  → options for `navigator.credentials.get()`
 * POST → verify the assertion and, on success, start a session
 *
 * Rate limited like password sign-in: a passkey assertion is cheap to attempt
 * but the lookup and verification should not be a free resource to burn.
 */

export async function GET() {
  return trackRoute("/api/auth/passkey/authenticate", "GET", () => handleGet());
}

async function handleGet() {
  try {
    const options = await startPasskeyAuthentication();
    return NextResponse.json(options, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Passkey authentication options failed",
    );
    return NextResponse.json(
      { error: "Could not start passkey sign-in." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return trackRoute("/api/auth/passkey/authenticate", "POST", () =>
    handlePost(request),
  );
}

async function handlePost(request: Request) {
  const ip = await getClientIp();
  const limit = await consumeRateLimit("signIn", ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  let body: { response?: AuthenticationResponseJSON };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  if (!body.response) {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    const verified = await finishPasskeyAuthentication(body.response);
    const requestHeaders = await headers();
    const session = await createSession(verified.userId, {
      userAgent: requestHeaders.get("user-agent"),
      ipAddress: ip,
    });
    await setSessionCookie(session.token, session.expiresAt);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Passkey authentication failed",
    );
    return NextResponse.json(
      { error: "That passkey could not be verified." },
      { status: 500 },
    );
  }
}
