import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getClientIp } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { completeAuthorization, getAppleConfig } from "@/modules/auth/apple";
import { constantTimeEquals } from "@/modules/auth/apple-state";
import {
  clearPendingAppleSignInCookie,
  readPendingAppleSignInCookie,
  setSessionCookie,
} from "@/modules/auth/cookies";
import {
  AuthError,
  linkAppleIdentity,
  signInWithApple,
} from "@/modules/auth/service";
import { applyStoredPreferences } from "@/i18n/cookie";

/**
 * Where Apple sends the result.
 *
 * A POST from appleid.apple.com, because `response_mode=form_post` is required
 * for the scopes this asks for. That has two consequences worth stating:
 *
 *  - It is a genuine cross-origin POST, so proxy.ts skips its origin check for
 *    this one path. The `state` comparison below replaces it, and for this
 *    purpose it is the stronger check: an attacker cannot produce a state that
 *    matches a signed cookie only the victim's browser holds.
 *  - Neither can the session cookie be read here — Lax means it is not sent on
 *    a cross-site POST. Whether this is a sign-in or a link, and for whom, was
 *    therefore decided at /start and travels in the pending cookie.
 *
 * Nothing in the posted body is trusted. The code is worthless without the
 * client secret only this instance can sign, and every claim acted on comes
 * from the id_token after its signature, issuer, audience, expiry and nonce
 * have been checked.
 */

/** Apple posts these. `user` arrives on the first authorization only. */
const callbackSchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(200).optional(),
  user: z.string().max(4096).optional(),
});

/** The `user` field's shape, when Apple sends it. */
const appleUserSchema = z.object({
  name: z
    .object({
      firstName: z.string().max(200).optional(),
      lastName: z.string().max(200).optional(),
    })
    .optional(),
});

function redirectTo(path: string, params: Record<string, string> = {}) {
  const url = new URL(path, getEnv().appOrigin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, 303);
}

function backToSignIn(reason?: string): NextResponse {
  return redirectTo("/sign-in", reason ? { error: reason } : {});
}

/** Apple's own name fields, joined into the one field Balancia stores. */
function readFullName(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = appleUserSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const { firstName, lastName } = parsed.data.name ?? {};
    return [firstName, lastName].filter(Boolean).join(" ").trim() || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const ip = await getClientIp();

  const limit = await consumeRateLimit("signIn", ip);
  if (!limit.allowed) {
    return backToSignIn("rateLimited");
  }

  let fields: z.infer<typeof callbackSchema>;
  try {
    const parsed = callbackSchema.safeParse(
      Object.fromEntries(await request.formData()),
    );
    if (!parsed.success) return backToSignIn("generic");
    fields = parsed.data;
  } catch {
    return backToSignIn("generic");
  }

  // The pending cookie is single-use whatever happens next, so an abandoned or
  // failed attempt cannot be replayed with a second code.
  const pending = await readPendingAppleSignInCookie();
  await clearPendingAppleSignInCookie();

  const isLink = pending?.linkUserId !== undefined;
  const failedLink = (reason: string) =>
    redirectTo("/profile/security", { error: reason });

  if (fields.error) {
    // "user_cancelled_authorize" is somebody closing Apple's sheet. Returning
    // them to a page wearing an error message would be rude.
    if (fields.error === "user_cancelled_authorize") {
      return isLink ? redirectTo("/profile/security") : backToSignIn();
    }
    logger.warn(
      { reason: fields.error },
      "Apple returned an authorization error",
    );
    return isLink ? failedLink("appleFailed") : backToSignIn("appleFailed");
  }

  if (
    !pending ||
    !fields.state ||
    !constantTimeEquals(pending.state, fields.state)
  ) {
    logger.warn(
      { hadCookie: pending !== null },
      "Apple callback did not match a pending sign-in",
    );
    return backToSignIn("appleExpired");
  }

  const config = getAppleConfig();
  if (!fields.code || !config) return backToSignIn("generic");

  let identity;
  try {
    identity = await completeAuthorization(config, {
      code: fields.code,
      nonce: pending.nonce,
    });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Apple authorization could not be completed",
    );
    return isLink ? failedLink("appleFailed") : backToSignIn("appleFailed");
  }

  if (pending.linkUserId) {
    try {
      await linkAppleIdentity(pending.linkUserId, identity);
    } catch (error) {
      if (error instanceof AuthError) {
        return failedLink(error.code ?? "generic");
      }
      logger.error(
        {
          err:
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error),
        },
        "Linking an Apple identity failed",
      );
      return failedLink("generic");
    }
    return redirectTo("/profile/security", { linked: "apple" });
  }

  const requestHeaders = await headers();
  try {
    const result = await signInWithApple(identity, {
      userAgent: requestHeaders.get("user-agent"),
      ipAddress: ip,
      fullName: readFullName(fields.user),
    });
    await setSessionCookie(result.session.token, result.session.expiresAt);
    // Seed the display cookies from the account, as password sign-in does.
    await applyStoredPreferences(result.preferences);
  } catch (error) {
    if (error instanceof AuthError) {
      return backToSignIn(error.code ?? "generic");
    }
    logger.error(
      {
        err:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
      },
      "Apple sign-in failed",
    );
    return backToSignIn("generic");
  }

  return redirectTo("/dashboard");
}

/**
 * Apple only ever POSTs here. A GET is somebody following the return URL by
 * hand, and the sign-in page is a better answer than a 405.
 */
export async function GET() {
  return backToSignIn();
}
