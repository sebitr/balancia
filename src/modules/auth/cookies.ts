import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import { GUEST_COOKIE_NAME } from "@/lib/security/guest-session";
import { JOIN_COOKIE_NAME, JOIN_COOKIE_TTL_MS } from "@/lib/security/join-link";
import { SESSION_COOKIE_NAME } from "./sessions";
import {
  APPLE_STATE_COOKIE_NAME,
  APPLE_STATE_COOKIE_PATH,
  APPLE_STATE_TTL_SECONDS,
  decodePendingSignIn,
  encodePendingSignIn,
  type PendingAppleSignIn,
} from "./apple-state";
import {
  REGISTRATION_COOKIE_NAME,
  REGISTRATION_COOKIE_PATH,
  REGISTRATION_COOKIE_TTL_SECONDS,
  encodeRegistration,
  registeredHere,
} from "./registration-browser";

/**
 * Cookie handling.
 *
 * One place decides every cookie's security attributes, so they cannot drift
 * between the sign-in and sign-out paths:
 *
 *  - HttpOnly: JavaScript, including anything injected, cannot read the token.
 *  - SameSite=Lax: the cookie is not sent on cross-site POSTs, which blocks
 *    the classic CSRF shape while keeping ordinary inbound links working.
 *  - Secure: set whenever the public URL is HTTPS. Omitted on localhost only,
 *    because browsers refuse Secure cookies over plain HTTP.
 *
 * The Apple state cookie at the bottom is the one exception to the second
 * rule, and it is here rather than beside its own module so that the exception
 * is visible next to what it departs from. See apple-state.ts for why it has
 * to be SameSite=None, and what is done to keep that narrow.
 */

export async function setSessionCookie(
  token: string,
  expiresAt: Date,
): Promise<void> {
  const env = getEnv();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appOrigin.startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function readSessionCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value;
}

/**
 * The guest session cookie, which carries the same three attributes for the
 * same three reasons. It is here rather than in the redemption handler so that
 * the two cookies that stand for an identity cannot drift apart: sign-in reads
 * this one to claim the guest's participant, and clears it once it has.
 */
export async function setGuestCookie(
  token: string,
  expiresAt: Date,
): Promise<void> {
  const env = getEnv();
  const cookieStore = await cookies();
  cookieStore.set(GUEST_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appOrigin.startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}

export async function clearGuestCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(GUEST_COOKIE_NAME);
}

export async function readGuestCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(GUEST_COOKIE_NAME)?.value;
}

/**
 * The in-flight group join.
 *
 * Same three attributes again, and a short life rather than an expiry date:
 * this one stands for a decision being made, not for an identity. It carries
 * the join link's own token — see join-link.ts for why that is the right
 * amount of power for it to have — and the flow clears it on the way out.
 */
export async function setJoinCookie(token: string): Promise<void> {
  const env = getEnv();
  const cookieStore = await cookies();
  cookieStore.set(JOIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appOrigin.startsWith("https://"),
    path: "/",
    maxAge: Math.floor(JOIN_COOKIE_TTL_MS / 1000),
  });
}

export async function clearJoinCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(JOIN_COOKIE_NAME);
}

export async function readJoinCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(JOIN_COOKIE_NAME)?.value;
}

/**
 * The browser that registered, for the confirmation link to recognise.
 *
 * The same three attributes, a path that reaches only `/verify-email`, and
 * the life of the link. Lax is enough: the link arrives as a top-level GET
 * from a mail client, which is exactly the cross-site request Lax still sends
 * a cookie on. See registration-browser.ts for why it exists at all.
 */
export async function setRegistrationCookie(userId: string): Promise<void> {
  const env = getEnv();
  const cookieStore = await cookies();
  cookieStore.set(REGISTRATION_COOKIE_NAME, encodeRegistration(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appOrigin.startsWith("https://"),
    path: REGISTRATION_COOKIE_PATH,
    maxAge: REGISTRATION_COOKIE_TTL_SECONDS,
  });
}

/** Whether this browser registered `userId`, by the cookie above. */
export async function isRegistrationBrowser(userId: string): Promise<boolean> {
  const cookieStore = await cookies();
  return registeredHere(
    cookieStore.get(REGISTRATION_COOKIE_NAME)?.value,
    userId,
  );
}

export async function clearRegistrationCookie(): Promise<void> {
  const env = getEnv();
  const cookieStore = await cookies();
  // Expired on the path it was set on; a bare delete would name `/` and miss.
  cookieStore.set(REGISTRATION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appOrigin.startsWith("https://"),
    path: REGISTRATION_COOKIE_PATH,
    maxAge: 0,
  });
}

/**
 * The in-flight Apple sign-in.
 *
 * SameSite=None because Apple returns its result as a cross-site form POST,
 * on which a Lax cookie is deliberately not sent — this cookie would simply be
 * absent at the callback, and every sign-in would fail. Secure is
 * unconditional rather than derived from the origin, because SameSite=None is
 * only honoured on a Secure cookie and the environment already refuses to
 * enable Apple sign-in on anything but HTTPS.
 *
 * What keeps that narrow: a ten-minute life, a path that reaches only the two
 * Apple endpoints, deletion on first read, and an HMAC so the value cannot be
 * planted by anything that can write cookies for this host.
 */
export async function setPendingAppleSignInCookie(
  pending: PendingAppleSignIn,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(APPLE_STATE_COOKIE_NAME, encodePendingSignIn(pending), {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: APPLE_STATE_COOKIE_PATH,
    maxAge: APPLE_STATE_TTL_SECONDS,
  });
}

export async function readPendingAppleSignInCookie(): Promise<PendingAppleSignIn | null> {
  const cookieStore = await cookies();
  return decodePendingSignIn(cookieStore.get(APPLE_STATE_COOKIE_NAME)?.value);
}

export async function clearPendingAppleSignInCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(APPLE_STATE_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: APPLE_STATE_COOKIE_PATH,
    maxAge: 0,
  });
}
