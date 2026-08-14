"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionError, runAction, type ActionResult } from "@/lib/actions";
import { getClientIp, getCurrentUser } from "@/lib/security/actor";
import { consumeRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
import {
  AuthError,
  changePassword,
  registerUser,
  requestPasswordReset,
  resetPassword,
  signInWithPassword,
  unlinkAppleIdentity,
  verifyEmail,
} from "./service";
import { revokeSession } from "./sessions";
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from "./cookies";
import { applyStoredPreferences } from "@/i18n/cookie";
import { resolveRequestLocale } from "@/i18n/request";

/**
 * Authentication Server Actions.
 *
 * Rate limiting happens here, before any password work: an attacker should not
 * be able to make the server run scrypt thousands of times.
 */

/**
 * Schema messages are catalogue keys, not prose. These only surface when a
 * request bypasses the client-side form, but when they do they should be in
 * the reader's language like everything else.
 */
const registerSchema = z.object({
  name: z.string().trim().min(1, "name").max(120),
  email: z.email("email"),
  password: z.string().min(10, "passwordMin").max(512),
});

const signInSchema = z.object({
  email: z.email("email"),
  password: z.string().min(1, "password"),
});

/** Translates the first Zod issue, falling back to a generic prompt. */
async function validationError(issueKey: string | undefined) {
  const t = await getTranslations("serverValidation");
  const key = issueKey as Parameters<typeof t.has>[0] | undefined;
  return actionError(key && t.has(key) ? t(key) : t("checkForm"));
}

async function requestContext(): Promise<{
  userAgent: string | null;
  ipAddress: string;
  locale: string;
}> {
  const requestHeaders = await headers();
  return {
    userAgent: requestHeaders.get("user-agent"),
    ipAddress: await getClientIp(),
    // Carried into registration so the verification mail is written in the
    // language the person was actually reading when they signed up.
    locale: await resolveRequestLocale(),
  };
}

export interface RegisterActionResult {
  readonly verificationRequired: boolean;
}

export async function registerAction(
  input: unknown,
): Promise<ActionResult<RegisterActionResult>> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message);
  }

  const context = await requestContext();
  return runAction("auth.register", async () => {
    const limit = await consumeRateLimit("signUp", context.ipAddress);
    if (!limit.allowed) {
      throw new RateLimitedError(limit.retryAfterSeconds);
    }

    const result = await registerUser(parsed.data, context);
    if (result.session) {
      await setSessionCookie(result.session.token, result.session.expiresAt);
    }
    return { verificationRequired: result.verificationRequired };
  });
}

export async function signInAction(input: unknown): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message);
  }

  const context = await requestContext();
  return runAction("auth.signIn", async () => {
    const limit = await consumeRateLimit("signIn", context.ipAddress);
    if (!limit.allowed) {
      throw new RateLimitedError(limit.retryAfterSeconds);
    }

    const result = await signInWithPassword(parsed.data, context);
    await setSessionCookie(result.session.token, result.session.expiresAt);
    // Seed the display cookies from the account, so a new browser opens in the
    // language and notation this person already chose elsewhere.
    await applyStoredPreferences(result.preferences);
  });
}

export async function signOutAction(): Promise<void> {
  const token = await readSessionCookie();
  if (token) {
    await revokeSession(token);
  }
  await clearSessionCookie();
  redirect("/");
}

export async function requestPasswordResetAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = z.object({ email: z.email("email") }).safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message);
  }

  const context = await requestContext();
  return runAction("auth.requestPasswordReset", async () => {
    const limit = await consumeRateLimit("passwordReset", context.ipAddress);
    if (!limit.allowed) {
      throw new RateLimitedError(limit.retryAfterSeconds);
    }
    await requestPasswordReset(parsed.data.email);
  });
}

export async function resetPasswordAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = z
    .object({
      token: z.string().min(1),
      password: z.string().min(10, "passwordMin").max(512),
    })
    .safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message);
  }

  return runAction("auth.resetPassword", async () => {
    const ok = await resetPassword(parsed.data.token, parsed.data.password);
    if (!ok) {
      throw new AuthError(
        "That reset link is no longer valid. Ask for a new one.",
        "resetLinkInvalid",
      );
    }
  });
}

export async function verifyEmailAction(token: string): Promise<ActionResult> {
  return runAction("auth.verifyEmail", async () => {
    const ok = await verifyEmail(token);
    if (!ok) {
      throw new AuthError(
        "That confirmation link is no longer valid. Sign in to request another.",
        "confirmLinkInvalid",
      );
    }
  });
}

/**
 * Unlinks the Apple account.
 *
 * Linking is not an action: it needs a round trip through Apple, so it starts
 * at /api/auth/apple/start like any other sign-in and comes back knowing who
 * asked. Removing the link needs nobody's permission but the account holder's,
 * and the service refuses if it would leave them locked out.
 */
export async function unlinkAppleAction(): Promise<ActionResult> {
  return runAction("auth.unlinkApple", async () => {
    const user = await getCurrentUser();
    if (!user) {
      throw new AuthError("Sign in to change your account.", "signInRequired");
    }
    await unlinkAppleIdentity(user.userId);
    revalidatePath("/profile/security");
  });
}

export async function changePasswordAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = z
    .object({
      currentPassword: z.string().min(1, "currentPassword"),
      newPassword: z.string().min(10, "passwordMin").max(512),
    })
    .safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message);
  }

  return runAction("auth.changePassword", async () => {
    const user = await getCurrentUser();
    if (!user) {
      throw new AuthError("Sign in to change your password.", "signInRequired");
    }
    await changePassword(
      user.userId,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    revalidatePath("/profile/security");
  });
}
