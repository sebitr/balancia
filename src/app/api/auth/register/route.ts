import { z } from "zod";
import { getClientIp } from "@/lib/security/actor";
import { consumeRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
import { AuthError, registerUser } from "@/modules/auth/service";
import { setSessionCookie } from "@/modules/auth/cookies";
import {
  invalidInput,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Account creation for native clients — the same `registerUser` the web form
 * calls, with the same rate bucket in front of it. With SMTP configured the
 * instance mails a confirmation and issues no session (`verificationRequired`
 * tells the client to say "check your email"); without SMTP the session
 * cookie is set right away, exactly like the web.
 */
const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.email("Enter a valid email address."),
  password: z
    .string()
    .min(10, "Use at least 10 characters.")
    .max(512, "That password is too long."),
});

export async function POST(request: Request) {
  return trackRoute("/api/auth/register", "POST", () => handlePost(request));
}

async function handlePost(request: Request) {
  const body = await readJsonBody(request);
  if (body === undefined) {
    return noStore({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    const ipAddress = await getClientIp();
    const limit = await consumeRateLimit("signUp", ipAddress);
    if (!limit.allowed) {
      throw new RateLimitedError(limit.retryAfterSeconds);
    }

    const result = await registerUser(parsed.data, {
      userAgent: request.headers.get("user-agent"),
      ipAddress,
    });

    if (result.session) {
      await setSessionCookie(result.session.token, result.session.expiresAt);
    }

    return noStore(
      {
        user: {
          id: result.user.userId,
          email: result.user.email,
          name: result.user.name,
          emailVerified: result.user.emailVerified,
        },
        verificationRequired: result.verificationRequired,
      },
      { status: 201 },
    );
  } catch (error) {
    // Registration refusals — email taken, registration closed, password
    // policy — are written for people and safe to show; they are input
    // problems here, not the 401 a failed sign-in maps to.
    if (error instanceof AuthError) {
      return noStore({ error: error.message }, { status: 422 });
    }
    return mobileApiError(error, "/api/auth/register POST");
  }
}
