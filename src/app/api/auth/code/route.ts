import { z } from "zod";
import { getClientIp } from "@/lib/security/actor";
import { consumeRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
import { AuthError } from "@/modules/auth/service";
import { requestSignInCode } from "@/modules/auth/signup";
import { resolveRequestLocale } from "@/i18n/request";
import {
  invalidInput,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * "Email me a sign-in code", for native clients.
 *
 * The web asks through `requestSignInCodeAction`; a native client cannot call
 * an action, so this is the same request over JSON — the same `signInCode`
 * bucket in front of it, the same `requestSignInCode` behind it, and the same
 * answer whether or not the address has an account. That last part is the
 * rule the whole thing rests on: an endpoint that answered differently would
 * list a deployment's users to anyone who asked.
 *
 * The code itself is spent on `POST /api/auth/session` with `{email, code}`
 * in place of a password — one route for a session, whichever proof was
 * offered.
 */

const requestSchema = z.object({
  email: z.email("Enter a valid email address."),
});

export async function POST(request: Request) {
  return trackRoute("/api/auth/code", "POST", () => handlePost(request));
}

async function handlePost(request: Request) {
  const body = await readJsonBody(request);
  if (body === undefined) {
    return noStore({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    const ipAddress = await getClientIp();
    const limit = await consumeRateLimit("signInCode", ipAddress);
    if (!limit.allowed) {
      throw new RateLimitedError(limit.retryAfterSeconds);
    }

    await requestSignInCode(parsed.data.email, {
      userAgent: request.headers.get("user-agent"),
      ipAddress,
      // The mail is written in the account's own language when it has one;
      // this is the fallback for an account that never chose.
      locale: await resolveRequestLocale(),
    });

    return noStore({ ok: true });
  } catch (error) {
    // The one refusal this route has of its own: an instance without a mail
    // server. It is a fact about the deployment rather than a bad credential,
    // so it is a 422 the client can explain, not the 401 the shared funnel
    // maps an AuthError to. `/api/auth/options` says the same thing up front,
    // so a client that read it never gets here.
    if (error instanceof AuthError) {
      return noStore({ error: error.message }, { status: 422 });
    }
    return mobileApiError(error, "/api/auth/code POST");
  }
}
