import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/security/actor";
import { AuthError } from "@/modules/auth/service";
import {
  acceptsSilentPasskeyUpgrade,
  startPasskeyRegistration,
} from "@/modules/auth/webauthn";
import { logger } from "@/lib/logger";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Options for a passkey the reader did not ask for.
 *
 * Its own route rather than a flag on `/register`, because the two differ in
 * the only way that matters here: `/register` answers a button somebody
 * pressed and must always work, while this answers a ceremony that starts on
 * its own after a password sign-in and therefore has to be refusable.
 *
 * **204 means "not for this account".** Somebody who has removed a passkey has
 * said what they think of having one, and minting another behind their back
 * moments later would be the app overruling them — silently, so they would
 * only discover it by going back to the screen where they said no. The empty
 * answer is not an error and is not reported to anybody: the reader asked to
 * sign in, and they are signed in.
 */
export async function GET() {
  return trackRoute("/api/auth/passkey/upgrade", "GET", () => handleGet());
}

async function handleGet() {
  const user = await getCurrentUser();
  if (!user) {
    const t = await getTranslations("serverErrors");
    return NextResponse.json({ error: t("authRequired") }, { status: 401 });
  }

  if (!(await acceptsSilentPasskeyUpgrade(user.userId))) {
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const options = await startPasskeyRegistration(user.userId);
    return NextResponse.json(options, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    /*
     * Nothing here is worth a status a caller would act on. This ceremony was
     * nobody's request, so a failure to offer it is a non-event — logged
     * because a *persistent* one means the upgrade quietly stopped working for
     * everybody, which is exactly the kind of thing that goes unnoticed when
     * the feature is designed to be invisible.
     */
    if (!(error instanceof AuthError)) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "Passkey upgrade options failed",
      );
    }
    return new NextResponse(null, { status: 204 });
  }
}
