import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getCurrentUser } from "@/lib/security/actor";
import { describeError } from "@/lib/server-errors";
import { AuthError } from "@/modules/auth/service";
import {
  finishPasskeyRegistration,
  startPasskeyRegistration,
} from "@/modules/auth/webauthn";
import { logger } from "@/lib/logger";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Passkey registration ceremony for the signed-in user.
 *
 * GET  → options (with a server-issued challenge)
 * POST → verify the authenticator's response and store the credential
 *
 * These are route handlers rather than Server Actions because the browser's
 * WebAuthn API needs a plain request/response pair either side of a call to
 * `navigator.credentials.create()`.
 */

export async function GET() {
  return trackRoute("/api/auth/passkey/register", "GET", () => handleGet());
}

async function handleGet() {
  const t = await getTranslations("serverErrors");

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: t("authRequired") }, { status: 401 });
  }

  try {
    const options = await startPasskeyRegistration(user.userId);
    return NextResponse.json(options, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: await describeError(error) },
        { status: 400 },
      );
    }
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Passkey registration options failed",
    );
    return NextResponse.json(
      { error: t("passkeyRegistrationUnavailable") },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return trackRoute("/api/auth/passkey/register", "POST", () =>
    handlePost(request),
  );
}

async function handlePost(request: Request) {
  const t = await getTranslations("serverErrors");

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: t("authRequired") }, { status: 401 });
  }

  let body: { response?: RegistrationResponseJSON; name?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: t("malformedRequest") }, { status: 400 });
  }

  if (!body.response) {
    return NextResponse.json({ error: t("malformedRequest") }, { status: 400 });
  }

  try {
    const created = await finishPasskeyRegistration(
      user.userId,
      body.response,
      body.name,
    );
    return NextResponse.json({ id: created.id });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: await describeError(error) },
        { status: 400 },
      );
    }
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Passkey registration failed",
    );
    return NextResponse.json(
      { error: t("passkeyNotRegistered") },
      { status: 500 },
    );
  }
}
