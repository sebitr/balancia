import "server-only";
import { z } from "zod";
import { open, seal } from "@/lib/security/secret-box";

/**
 * Which browser registered the account a confirmation link is for.
 *
 * Spending the link proves control of the inbox, and nothing about who is
 * holding the browser it was opened in. For a long time that did not matter,
 * because the link only marked the address verified. It started to matter the
 * day `/verify-email` began signing the opener in, since a new session is
 * settled like any other — which claims whatever guest seat the browser's
 * cookie holds. A link is only a URL, and a URL can be forwarded: somebody
 * registers their own address, leaves the mail unopened, and sends the link
 * to a guest in some group. One click signs the guest's browser into the
 * sender's account and moves the guest's seat, their history and their
 * balance, across to it, retiring the guest's own link on the way.
 *
 * So registration leaves this cookie behind, and the link signs in only a
 * browser that carries it for the same account. Everywhere else it still
 * confirms the address — the person may simply have read their mail on
 * another device — and the sign-in page says so, and asks for the password
 * that the forwarder, by construction, never handed over.
 *
 * The value is sealed rather than merely random, so the route needs no row to
 * check it against: it opens only under this instance's `AUTH_SECRET`, only
 * for this purpose, and it names the account and when it stops counting. A
 * cookie planted from elsewhere, or one lifted from another account's
 * registration, opens to the wrong answer or to nothing.
 */

export const REGISTRATION_COOKIE_NAME = "balancia_registration";

/**
 * Sent to the one route that spends the link and to nothing else, so the
 * cookie never rides along with a page request.
 */
export const REGISTRATION_COOKIE_PATH = "/verify-email";

/**
 * As long as the link it vouches for (`EMAIL_VERIFICATION_TTL_MS`): a
 * confirmation read after supper should still sign in the browser that asked
 * for it.
 */
export const REGISTRATION_COOKIE_TTL_SECONDS = 24 * 60 * 60;

const PURPOSE = "registration-browser";

const payloadSchema = z.object({
  userId: z.uuid(),
  /** Milliseconds since the epoch. */
  expiresAt: z.number().int(),
});

export function encodeRegistration(userId: string, now = new Date()): string {
  return seal(
    PURPOSE,
    JSON.stringify({
      userId,
      expiresAt: now.getTime() + REGISTRATION_COOKIE_TTL_SECONDS * 1000,
    }),
  );
}

/**
 * Whether the cookie says this browser registered `userId`, and still counts.
 *
 * The expiry travels inside the seal as well as on the cookie, because the
 * browser's own expiry is a courtesy the server cannot see: a value copied
 * out of a cookie jar would otherwise vouch for its account forever.
 */
export function registeredHere(
  raw: string | undefined,
  userId: string,
  now = new Date(),
): boolean {
  const opened = open(PURPOSE, raw ?? null);
  if (!opened) return false;

  try {
    const parsed = payloadSchema.safeParse(JSON.parse(opened));
    return (
      parsed.success &&
      parsed.data.userId === userId &&
      parsed.data.expiresAt > now.getTime()
    );
  } catch {
    return false;
  }
}
