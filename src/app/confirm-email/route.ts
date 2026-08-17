import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getCurrentUser } from "@/lib/security/actor";
import { confirmEmailChange } from "@/modules/auth/service";

/**
 * The link that completes an email change.
 *
 * A route handler for the reasons given in /verify-email: the token is spent
 * once, here, and does not survive into the address bar.
 *
 * Where the redirect lands depends on the browser, not on the account. This
 * link is opened wherever the new inbox is read, which is often a device that
 * has never signed in — so a session gets the profile screen and its notice,
 * and everyone else gets the sign-in page carrying the same outcome.
 */
export async function GET(request: Request) {
  const env = getEnv();
  const token = new URL(request.url).searchParams.get("token");

  const outcome = token ? await confirmEmailChange(token) : "invalid";
  if (outcome !== "changed") {
    logger.info({ outcome }, "Email change link did not complete");
  }

  const destination = (await getCurrentUser()) ? "/profile" : "/sign-in";
  return NextResponse.redirect(
    new URL(`${destination}?emailChange=${outcome}`, env.appOrigin),
    { status: 303 },
  );
}
