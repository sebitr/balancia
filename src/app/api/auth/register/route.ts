import { z } from "zod";
import { getClientIp } from "@/lib/security/actor";
import { guardSignUp } from "@/lib/security/signup-guard";
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
/**
 * The answer to `/api/auth/challenge`, when this instance asked for one. A
 * native client that has never heard of it simply sends nothing, and is
 * refused only where the instance is configured to want it.
 */
const proofOfWorkSchema = z
  .object({
    nonce: z.string().min(1).max(64),
    number: z.number().int().nonnegative(),
  })
  .nullish();

const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.email("Enter a valid email address."),
  password: z
    .string()
    .min(10, "Use at least 10 characters.")
    .max(512, "That password is too long."),
  proofOfWork: proofOfWorkSchema,
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
    const { proofOfWork, ...credentials } = parsed.data;
    await guardSignUp({ ipAddress, email: credentials.email, proofOfWork });

    const result = await registerUser(credentials, {
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
    // Registration refusals — email taken, registration closed — are written
    // for people and safe to show, and are input problems here rather than
    // the 401 the shared funnel maps an AuthError to. The password policy
    // and the proof of work are already 422 there, so they fall through.
    if (error instanceof AuthError) {
      return noStore({ error: error.message }, { status: 422 });
    }
    return mobileApiError(error, "/api/auth/register POST");
  }
}
