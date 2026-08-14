import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/security/actor";
import { buildAuthorizationUrl, getAppleConfig } from "@/modules/auth/apple";
import { createPendingSignIn } from "@/modules/auth/apple-state";
import { setPendingAppleSignInCookie } from "@/modules/auth/cookies";

/**
 * Starts the Apple sign-in ceremony.
 *
 * A GET, because it is a plain navigation: the browser follows the redirect to
 * Apple and comes back to the callback. Nothing here is a state change worth
 * protecting — the two random values it mints are useless to anyone who cannot
 * also read the cookie they are written to.
 *
 * This request is same-site, so it is also the only point in the ceremony
 * where the session cookie is present. If someone is already signed in they
 * are linking Apple to that account rather than signing in, and their user ID
 * is recorded in the (signed) pending cookie now, because the callback will
 * have no way to ask.
 *
 * Deliberately unrate-limited: it touches no database beyond resolving the
 * session and does no crypto beyond two `randomBytes` calls, so counting
 * attempts would cost an upsert to save nothing.
 */

export async function GET() {
  const config = getAppleConfig();
  if (!config) {
    // Not an error worth a status code: the button is not rendered on an
    // instance without Apple configured, so this is either a stale bookmark or
    // somebody poking at the URL.
    return NextResponse.redirect(new URL("/sign-in", getEnv().appOrigin), 303);
  }

  const current = await getCurrentUser();
  const pending = createPendingSignIn({ linkUserId: current?.userId });
  await setPendingAppleSignInCookie(pending);

  return NextResponse.redirect(buildAuthorizationUrl(config, pending), 303);
}
