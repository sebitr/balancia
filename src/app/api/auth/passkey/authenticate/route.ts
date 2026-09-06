import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { getClientIp } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { describeError } from "@/lib/server-errors";
import { AuthError } from "@/modules/auth/service";
import {
  finishPasskeyAuthentication,
  passkeySignalState,
  startPasskeyAuthentication,
} from "@/modules/auth/webauthn";
import { getEnv } from "@/lib/env";
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
 *
 * Both verbs are limited, on separate buckets. The GET is not a credential
 * attempt but it is not free either: every answer stores a challenge row, and
 * autofill asks for one on every load of the sign-in page — so an unmetered
 * GET is a table anybody can grow by reloading, cleaned up only by a
 * maintenance job running hours later.
 */

export async function GET() {
  return trackRoute("/api/auth/passkey/authenticate", "GET", () => handleGet());
}

async function handleGet() {
  const limit = await consumeRateLimit("passkeyChallenge", await getClientIp());
  if (!limit.allowed) {
    const t = await getTranslations("serverErrors");
    return NextResponse.json(
      {
        error: t("rateLimitedFor", {
          minutes: Math.max(1, Math.ceil(limit.retryAfterSeconds / 60)),
        }),
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

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
    const t = await getTranslations("serverErrors");
    return NextResponse.json(
      { error: t("passkeySignInUnavailable") },
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
  const t = await getTranslations("serverErrors");
  const ip = await getClientIp();
  const limit = await consumeRateLimit("signIn", ip);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: t("rateLimitedFor", {
          minutes: Math.max(1, Math.ceil(limit.retryAfterSeconds / 60)),
        }),
      },
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
    return NextResponse.json({ error: t("malformedRequest") }, { status: 400 });
  }
  if (!body.response) {
    return NextResponse.json({ error: t("malformedRequest") }, { status: 400 });
  }

  try {
    const verified = await finishPasskeyAuthentication(body.response);
    const requestHeaders = await headers();
    const session = await createSession(verified.userId, {
      userAgent: requestHeaders.get("user-agent"),
      ipAddress: ip,
    });
    await setSessionCookie(session.token, session.expiresAt);

    /*
     * Every sign-in is also a chance to tidy: the reader's password manager
     * may still be offering a credential this account no longer has, and this
     * is the one moment we can prove who they are before saying so.
     */
    const signal = await passkeySignalState(verified.userId);
    return NextResponse.json({
      ok: true,
      rpId: getEnv().webAuthnRpId,
      signal,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        {
          error: await describeError(error),
          /*
           * The reason, not just the sentence. `passkeyUnknown` is the one the
           * browser can act on — it means the credential it just offered is
           * not registered here, which is the cue to stop offering it — and
           * prose cannot be matched on once it has been translated.
           */
          code: error.code ?? null,
        },
        { status: 400 },
      );
    }
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Passkey authentication failed",
    );
    return NextResponse.json(
      { error: t("passkeyUnverified") },
      { status: 500 },
    );
  }
}
