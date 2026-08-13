import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import { SESSION_COOKIE_NAME } from "./sessions";

/**
 * Session cookie handling.
 *
 * One place decides the cookie's security attributes, so they cannot drift
 * between the sign-in and sign-out paths:
 *
 *  - HttpOnly: JavaScript, including anything injected, cannot read the token.
 *  - SameSite=Lax: the cookie is not sent on cross-site POSTs, which blocks
 *    the classic CSRF shape while keeping ordinary inbound links working.
 *  - Secure: set whenever the public URL is HTTPS. Omitted on localhost only,
 *    because browsers refuse Secure cookies over plain HTTP.
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
