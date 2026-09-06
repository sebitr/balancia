import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getClientIp, getCurrentActor } from "@/lib/security/actor";
import { consumeRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
import { signInWithPassword } from "@/modules/auth/service";
import { signInWithCode } from "@/modules/auth/signup";
import { normalizeCode } from "@/modules/auth/code-format";
import { revokeSession } from "@/modules/auth/sessions";
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from "@/modules/auth/cookies";
import {
  invalidInput,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { resolveAccent } from "@/modules/profile/accent";
import {
  DEFAULT_DATE_FORMAT,
  DEFAULT_NUMBER_FORMAT,
  isDateFormat,
  isNumberFormat,
} from "@/i18n/format";
import { DEFAULT_LOCALE, isAppLocale } from "@/i18n/locales";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Sessions for native clients.
 *
 * The web signs in through a Server Action; a native client cannot, so this
 * route does the same work over JSON: the same rate limit before any scrypt
 * runs, the same `signInWithPassword`, the same `balancia_session` cookie.
 * URLSession and its kin store and return that cookie on their own, so a
 * native app gets the browser's session model without a parallel token
 * scheme to issue, rotate and revoke.
 *
 * POST takes one of two proofs beside the address: a `password`, or the
 * `code` that `POST /api/auth/code` mailed — the web's "Email me a sign-in
 * code", which is the only way in this route can offer an account that was
 * created with a code or a passkey and so has no password to type. Each
 * proof keeps the bucket the web's action holds it to: the password by
 * caller, the code by address, because the guessing a code limit stops is
 * guessing at *one account's* code, and an attacker changing IP between
 * attempts must not get a fresh allowance for it.
 *
 * GET answers "who am I" for app launch; DELETE is sign-out. A guest cookie
 * is reported by GET but never created here — guests come in through the
 * `/join` links, which are already plain HTTP routes.
 */

const passwordSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

const codeSchema = z.object({
  email: z.email("Enter a valid email address."),
  code: z.string().trim().min(1, "Enter the code from the email."),
});

/**
 * The password first, so a body carrying both is a password sign-in and a
 * body carrying neither is refused with the sentence about the password —
 * the proof every account may have.
 */
const signInSchema = z.union([passwordSchema, codeSchema]);

export async function POST(request: Request) {
  return trackRoute("/api/auth/session", "POST", () => handlePost(request));
}

async function handlePost(request: Request) {
  const body = await readJsonBody(request);
  if (body === undefined) {
    return noStore({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = signInSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    const ipAddress = await getClientIp();
    const context = {
      userAgent: request.headers.get("user-agent"),
      ipAddress,
    };

    let result;
    if ("password" in parsed.data) {
      const limit = await consumeRateLimit("signIn", ipAddress);
      if (!limit.allowed) {
        throw new RateLimitedError(limit.retryAfterSeconds);
      }
      result = await signInWithPassword(parsed.data, context);
    } else {
      const limit = await consumeRateLimit(
        "verifyCode",
        parsed.data.email.toLowerCase(),
      );
      if (!limit.allowed) {
        throw new RateLimitedError(limit.retryAfterSeconds);
      }
      result = await signInWithCode(
        { email: parsed.data.email, code: normalizeCode(parsed.data.code) },
        context,
      );
    }
    await setSessionCookie(result.session.token, result.session.expiresAt);

    return noStore({ user: await currentUserPayload(result.user.userId) });
  } catch (error) {
    return mobileApiError(error, "/api/auth/session POST");
  }
}

export async function GET() {
  return trackRoute("/api/auth/session", "GET", handleGet);
}

async function handleGet() {
  try {
    const actor = await getCurrentActor();
    if (!actor) {
      return noStore({ error: "Sign in to continue." }, { status: 401 });
    }
    if (actor.kind === "guest") {
      return noStore({
        user: null,
        guest: {
          groupId: actor.groupId,
          participantId: actor.participantId,
          displayName: actor.displayName,
        },
      });
    }
    return noStore({
      user: await currentUserPayload(actor.userId),
      guest: null,
    });
  } catch (error) {
    return mobileApiError(error, "/api/auth/session GET");
  }
}

export async function DELETE() {
  return trackRoute("/api/auth/session", "DELETE", handleDelete);
}

async function handleDelete() {
  try {
    const token = await readSessionCookie();
    if (token) {
      await revokeSession(token);
    }
    await clearSessionCookie();
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, "/api/auth/session DELETE");
  }
}

/**
 * The account as the app's start screen needs it. `preferredCurrency` and the
 * favourites seed the expense form's currency picker, which is why this is a
 * fresh read rather than an echo of the actor.
 *
 * The four display preferences ride along because a native client has no
 * cookie to seed: the browser learns its accent and notation from cookies set
 * at sign-in, and the app learns them here, at the same moment and from the
 * same columns. They are resolved to the words the settings screens are
 * labelled with rather than sent as the nulls the columns hold — see the note
 * on `resolvedPreferences` in `/api/profile`.
 */
async function currentUserPayload(userId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerifiedAt: users.emailVerifiedAt,
      locale: users.locale,
      dateFormat: users.dateFormat,
      numberFormat: users.numberFormat,
      accentColor: users.accentColor,
      preferredCurrency: users.preferredCurrency,
      favoriteCurrencies: users.favoriteCurrencies,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.emailVerifiedAt !== null,
    locale: isAppLocale(row.locale) ? row.locale : DEFAULT_LOCALE,
    dateFormat: isDateFormat(row.dateFormat)
      ? row.dateFormat
      : DEFAULT_DATE_FORMAT,
    numberFormat: isNumberFormat(row.numberFormat)
      ? row.numberFormat
      : DEFAULT_NUMBER_FORMAT,
    accentColor: resolveAccent(row.accentColor),
    preferredCurrency: row.preferredCurrency,
    favoriteCurrencies: row.favoriteCurrencies,
  };
}
