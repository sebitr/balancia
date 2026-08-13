"use server";

import { z } from "zod";
import { headers } from "next/headers";
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
  verifyEmail,
} from "./service";
import { revokeSession } from "./sessions";
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from "./cookies";

/**
 * Authentication Server Actions.
 *
 * Rate limiting happens here, before any password work: an attacker should not
 * be able to make the server run scrypt thousands of times.
 */

const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: z.email("Enter a valid email address"),
  password: z.string().min(10, "Use at least 10 characters").max(512),
});

const signInSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

async function requestContext(): Promise<{
  userAgent: string | null;
  ipAddress: string;
}> {
  const requestHeaders = await headers();
  return {
    userAgent: requestHeaders.get("user-agent"),
    ipAddress: await getClientIp(),
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
    return actionError(parsed.error.issues[0]?.message ?? "Check the form.");
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
    return actionError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  const context = await requestContext();
  return runAction("auth.signIn", async () => {
    const limit = await consumeRateLimit("signIn", context.ipAddress);
    if (!limit.allowed) {
      throw new RateLimitedError(limit.retryAfterSeconds);
    }

    const result = await signInWithPassword(parsed.data, context);
    await setSessionCookie(result.session.token, result.session.expiresAt);
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
  const parsed = z
    .object({ email: z.email("Enter a valid email address") })
    .safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the form.");
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
      password: z.string().min(10, "Use at least 10 characters").max(512),
    })
    .safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  return runAction("auth.resetPassword", async () => {
    const ok = await resetPassword(parsed.data.token, parsed.data.password);
    if (!ok) {
      throw new AuthError(
        "That reset link is no longer valid. Ask for a new one.",
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
      );
    }
  });
}

export async function changePasswordAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = z
    .object({
      currentPassword: z.string().min(1, "Enter your current password"),
      newPassword: z.string().min(10, "Use at least 10 characters").max(512),
    })
    .safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  return runAction("auth.changePassword", async () => {
    const user = await getCurrentUser();
    if (!user) {
      throw new AuthError("Sign in to change your password.");
    }
    await changePassword(
      user.userId,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    revalidatePath("/profile/security");
  });
}
