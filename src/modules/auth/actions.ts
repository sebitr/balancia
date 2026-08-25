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
  deleteAccount,
  registerUser,
  requestEmailChange,
  requestPasswordReset,
  resetPassword,
  signInWithPassword,
  unlinkAppleIdentity,
  verifyEmail,
} from "./service";
import { revokeSession } from "./sessions";
import {
  clearGuestCookie,
  clearSessionCookie,
  readGuestCookie,
  readSessionCookie,
  setSessionCookie,
} from "./cookies";
import { claimGuestSession } from "@/modules/guests/service";
import { logger } from "@/lib/logger";
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

/**
 * Claims the guest identity this browser is holding, if it holds one.
 *
 * Called from both sign-up and sign-in, because the session that makes a claim
 * possible arrives at different moments: an instance with SMTP configured
 * issues none until the address is verified, so for those the claim lands on
 * the first sign-in instead. It is also what makes "I already have an account"
 * work from the invite screen.
 *
 * Failures are logged and swallowed. The authentication has already succeeded,
 * and nobody should be left without a session because the link they arrived on
 * could not be retired.
 */
async function claimGuestIdentity(userId: string): Promise<string | null> {
  const guestToken = await readGuestCookie();
  if (!guestToken) return null;

  try {
    const outcome = await claimGuestSession(userId, guestToken);
    if (outcome.status === "claimed") {
      await clearGuestCookie();
      return outcome.groupId;
    }
    // A dead cookie buys nobody anything. A conflicting one is kept: the claim
    // was skipped, so signing out should still return them to the guest.
    if (outcome.status === "none") {
      await clearGuestCookie();
    }
    return null;
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Guest claim failed after authentication",
    );
    return null;
  }
}

export interface RegisterActionResult {
  readonly verificationRequired: boolean;
  /** The group carried over from a guest session, when there was one. */
  readonly claimedGroupId: string | null;
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
    let claimedGroupId: string | null = null;
    if (result.session) {
      await setSessionCookie(result.session.token, result.session.expiresAt);
      claimedGroupId = await claimGuestIdentity(result.user.userId);
    }
    return {
      verificationRequired: result.verificationRequired,
      claimedGroupId,
    };
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
    // Signing in from a guest browser is the other way an account claims what
    // the guest did — the invite screen's third button, and the path taken
    // when sign-up required an email confirmation first.
    await claimGuestIdentity(result.user.userId);
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
    await requestPasswordReset(parsed.data.email, { locale: context.locale });
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

/**
 * Asks for the account's email address to be changed.
 *
 * Rate limited on the account, not the client address: what is being spent
 * here is mail sent to an inbox chosen by the caller, and the caller is signed
 * in, so there is a better key available than an IP shared by a household.
 *
 * Returns the normalized address so the screen can echo back where the
 * confirmation went, rather than whatever casing was typed.
 */
export async function requestEmailChangeAction(
  input: unknown,
): Promise<ActionResult<{ email: string }>> {
  const parsed = z.object({ email: z.email("email") }).safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message);
  }

  const context = await requestContext();
  return runAction("auth.requestEmailChange", async () => {
    const user = await getCurrentUser();
    if (!user) {
      throw new AuthError("Sign in to change your account.", "signInRequired");
    }

    const limit = await consumeRateLimit("emailChange", user.userId);
    if (!limit.allowed) {
      throw new RateLimitedError(limit.retryAfterSeconds);
    }

    const email = parsed.data.email.trim().toLowerCase();
    await requestEmailChange(user.userId, email, { locale: context.locale });
    return { email };
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
    revalidatePath("/settings/security");
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
    revalidatePath("/settings/security");
  });
}

/**
 * Closing the account, from the confirmation sheet on the Account screen.
 *
 * Two things guard it, and neither is the sheet: the caller is resolved here
 * rather than taken from the request, and the address they typed has to match
 * the one on the account. A confirmation dialog is a courtesy to somebody who
 * meant something else; it is not an authorization check, and this action is
 * reachable without ever seeing it.
 *
 * The session cookie is cleared before the redirect because the session it
 * named no longer exists — the row went with the account.
 */
export async function deleteAccountAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = z
    .object({ email: z.string().trim().min(1, "email") })
    .safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message);
  }

  const user = await getCurrentUser();
  if (!user) {
    const t = await getTranslations("serverErrors");
    return actionError(t("signedInRequired"));
  }

  if (
    parsed.data.email.toLocaleLowerCase() !== user.email.toLocaleLowerCase()
  ) {
    const t = await getTranslations("serverValidation");
    return actionError(t("emailMismatch"));
  }

  const result = await runAction("auth.deleteAccount", async () => {
    await deleteAccount(user.userId);
  });

  if (result.ok) await clearSessionCookie();
  return result;
}
