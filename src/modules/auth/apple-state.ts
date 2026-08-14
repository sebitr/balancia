import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getEnv } from "@/lib/env";

/**
 * The in-flight Apple sign-in, carried in a cookie between the two requests.
 *
 * It holds two random values, both minted here and both meaningless to anyone
 * who did not start this particular ceremony:
 *
 *  - `state` comes back from Apple as a form field. Comparing it to the cookie
 *    is what proves the callback belongs to a ceremony this browser began, and
 *    it is the entire CSRF defence for that endpoint — proxy.ts cannot apply
 *    its usual origin check to a POST that legitimately comes from Apple.
 *  - `nonce` is echoed inside the signed id_token, where nothing between here
 *    and Apple can alter it. It is what stops a token captured from one
 *    sign-in being replayed into another.
 *
 * ## Why SameSite=None
 *
 * Apple returns the result as a form POST from appleid.apple.com, and a Lax
 * cookie is deliberately not sent on a cross-site POST — so a Lax cookie here
 * would simply be absent at the callback and every sign-in would fail. `None`
 * is the only value that works. It is why this cookie is scoped to the Apple
 * endpoints, lives ten minutes, and is deleted the moment it is read. It
 * carries no authority of its own: holding it lets nobody sign in as anybody.
 * The session cookie the callback goes on to set is Lax as always.
 *
 * ## Why it is signed
 *
 * Because the same cross-site POST means the session cookie is *not* sent, so
 * the callback cannot ask who is signed in. When the ceremony was started by
 * someone linking Apple to an account they were already signed in to, that
 * identity has to travel in here — and a user ID in an unauthenticated cookie
 * would be an invitation to link an Apple account to somebody else's.
 * An HMAC over the payload closes that: only this instance can mint one.
 *
 * Signing is worth it even for the plain sign-in case, where there is no user
 * ID to protect. It means an attacker who can write cookies for this host —
 * from a sibling subdomain, say — still cannot plant a `state` of their
 * choosing and pair it with an authorization code of their own.
 */

/**
 * The cookie itself is written and read in cookies.ts, with every other
 * cookie in the app, so its attributes cannot drift from theirs. What lives
 * here is the value: how it is minted, sealed and checked.
 */

export const APPLE_STATE_COOKIE_NAME = "balancia_apple_auth";

/** Long enough for a password prompt and a 2FA code, short enough to matter. */
export const APPLE_STATE_TTL_SECONDS = 10 * 60;

/**
 * Restricting the path means the one SameSite=None cookie in the app rides
 * along with nothing else — it is never attached to a page request.
 */
export const APPLE_STATE_COOKIE_PATH = "/api/auth/apple";

const RANDOM_BYTES = 32;

const pendingSchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  /** Set when the ceremony is a deliberate link, not a sign-in. */
  linkUserId: z.uuid().optional(),
});

export type PendingAppleSignIn = z.infer<typeof pendingSchema>;

export function createPendingSignIn(
  options: { linkUserId?: string } = {},
): PendingAppleSignIn {
  return {
    state: randomBytes(RANDOM_BYTES).toString("base64url"),
    nonce: randomBytes(RANDOM_BYTES).toString("base64url"),
    ...(options.linkUserId ? { linkUserId: options.linkUserId } : {}),
  };
}

/**
 * Domain-separated so this signature can never be mistaken for, or reused as,
 * some other thing signed with the same instance secret later.
 */
function signPayload(payload: string): string {
  return createHmac("sha256", getEnv().AUTH_SECRET)
    .update(`apple-sign-in.v1.${payload}`)
    .digest("base64url");
}

export function encodePendingSignIn(pending: PendingAppleSignIn): string {
  const payload = Buffer.from(JSON.stringify(pending), "utf8").toString(
    "base64url",
  );
  return `${payload}.${signPayload(payload)}`;
}

export function decodePendingSignIn(
  raw: string | undefined,
): PendingAppleSignIn | null {
  if (!raw) return null;

  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);

  if (!constantTimeEquals(signature, signPayload(payload))) return null;

  try {
    const parsed = pendingSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Compares two values without leaking, through timing, how much of a guess was
 * right. Used for both the signature and the returned `state`.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}
