"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionError, runAction, type ActionResult } from "@/lib/actions";
import { getClientIp, getCurrentUser } from "@/lib/security/actor";
import { consumeRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
import { guardSignUp } from "@/lib/security/signup-guard";
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
} from "./service";
import { revokeSession } from "./sessions";
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from "./cookies";
import {
  claimGuestIdentity,
  settleNewSession,
  type CodeAuthResult,
} from "./session-handoff";
import {
  requestSignInCode,
  signInWithCode,
  startCodeSignup,
  verifySignupCode,
} from "./signup";
import { normalizeCode } from "./code-format";
import { applyStoredPreferences } from "@/i18n/cookie";
import { resolveRequestLocale } from "@/i18n/request";
import { getEnv } from "@/lib/env";
import { matchesDemoCredential } from "@/modules/demo/credentials";
import { startDemoAction } from "@/modules/demo/actions";
import { signOutDestination } from "@/modules/demo/exit";

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
/**
 * The answer to the challenge in `/api/auth/challenge`, when the instance
 * asked for one. Optional here and enforced in `guardSignUp`, so a client
 * talking to an instance that wants no proof sends nothing and a client
 * talking to one that does is refused by the server rather than by a schema.
 */
const proofOfWorkSchema = z
  .object({
    nonce: z.string().min(1).max(64),
    number: z.number().int().nonnegative(),
  })
  .nullish();

const registerSchema = z.object({
  name: z.string().trim().min(1, "name").max(120),
  email: z.email("email"),
  password: z.string().min(10, "passwordMin").max(512),
  proofOfWork: proofOfWorkSchema,
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
  const { proofOfWork, ...credentials } = parsed.data;

  return runAction("auth.register", async () => {
    await guardSignUp({
      ipAddress: context.ipAddress,
      email: credentials.email,
      proofOfWork,
    });

    const result = await registerUser(credentials, context);
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
  /*
   * On a demo instance, `demo` / `demo` is a door rather than an account: it
   * mints a fresh one with its own data. Checked before the schema because
   * `demo` is not an email address and never has to be.
   */
  if (getEnv().DEMO_MODE && matchesDemoCredential(input)) {
    return startDemoAction();
  }

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
  redirect(signOutDestination(getEnv()));
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

/**
 * The code half of onboarding.
 *
 * Four actions, in two pairs: ask for a code and spend it, once for an account
 * that is being created and once for one that already exists. They are here
 * rather than in the join module because what they do is authenticate — the
 * group work they may also finish is delegated to `joinFromLink`, which
 * takes the group from the join cookie and never from the form.
 *
 * The passkey path has no action of its own: WebAuthn needs a plain
 * request/response pair either side of `navigator.credentials.create()`, so it
 * lives in `/api/auth/passkey/signup` and ends in the same two helpers.
 */

const identitySchema = z.object({
  /**
   * Absent or null on the routes whose name screen comes after this one.
   *
   * An empty string is still refused — a form that posts one has a field
   * somebody cleared, which is not the same as never having been asked — and
   * a signup with no name at all gets a placeholder and a row the dashboard
   * knows to ask about.
   */
  name: z
    .string()
    .trim()
    .min(1, "name")
    .max(120)
    .nullish()
    .transform((value) => value ?? null),
  email: z.email("email"),
  proofOfWork: proofOfWorkSchema,
});

/**
 * Which listed member a shared-link signup is claiming, if any.
 *
 * `participantId` names a row from the list the link itself produced;
 * `displayName` is the name a person who was not on that list types instead.
 * Both are optional, because the personal-invitation and cold routes join
 * nothing here.
 */
const joinSchema = z
  .object({
    participantId: z.uuid().nullable().default(null),
    displayName: z.string().trim().max(120).default(""),
  })
  .optional();

const codeSchema = z.object({
  email: z.email("email"),
  code: z.string().trim().min(1, "code"),
  join: joinSchema,
});

/**
 * Creates the account and mails it a code.
 *
 * The account exists after this and cannot yet be signed in to, which is the
 * same state registering with a password has always left behind on an instance
 * that sends confirmation mail.
 */
export async function startCodeSignupAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message);
  }

  const context = await requestContext();
  const { proofOfWork, ...identity } = parsed.data;

  return runAction("auth.startCodeSignup", async () => {
    await guardSignUp({
      ipAddress: context.ipAddress,
      email: identity.email,
      proofOfWork,
    });

    await startCodeSignup(identity, context);
  });
}

/** Spends the code, signs the new account in, and joins whatever it arrived on. */
export async function verifySignupCodeAction(
  input: unknown,
): Promise<ActionResult<CodeAuthResult>> {
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message);
  }

  const context = await requestContext();
  return runAction("auth.verifySignupCode", async () => {
    // Keyed by the address rather than the caller: the guessing this stops is
    // guessing at one account's code, and an attacker changing IP between
    // attempts must not get a fresh allowance for it.
    const limit = await consumeRateLimit(
      "verifyCode",
      parsed.data.email.toLowerCase(),
    );
    if (!limit.allowed) {
      throw new RateLimitedError(limit.retryAfterSeconds);
    }

    const result = await verifySignupCode(
      { email: parsed.data.email, code: normalizeCode(parsed.data.code) },
      context,
    );
    return revalidateJoined(
      await settleNewSession(result.user.userId, result.session, parsed.data),
    );
  });
}

/**
 * Mails a sign-in code to an account that has no password to type.
 *
 * Always reports success. Whether the address is registered is not this
 * endpoint's to disclose.
 */
export async function requestSignInCodeAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = z.object({ email: z.email("email") }).safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message);
  }

  const context = await requestContext();
  return runAction("auth.requestSignInCode", async () => {
    const limit = await consumeRateLimit("signInCode", context.ipAddress);
    if (!limit.allowed) {
      throw new RateLimitedError(limit.retryAfterSeconds);
    }

    await requestSignInCode(parsed.data.email, context);
  });
}

/** Signs an existing account in with a mailed code. */
export async function signInWithCodeAction(
  input: unknown,
): Promise<ActionResult<CodeAuthResult>> {
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message);
  }

  const context = await requestContext();
  return runAction("auth.signInWithCode", async () => {
    const limit = await consumeRateLimit(
      "verifyCode",
      parsed.data.email.toLowerCase(),
    );
    if (!limit.allowed) {
      throw new RateLimitedError(limit.retryAfterSeconds);
    }

    const result = await signInWithCode(
      { email: parsed.data.email, code: normalizeCode(parsed.data.code) },
      context,
    );
    if (result.preferences) {
      // Seed the display cookies from the account, so a new browser opens in
      // the language and notation this person already chose elsewhere.
      await applyStoredPreferences(result.preferences);
    }
    return revalidateJoined(
      await settleNewSession(result.user.userId, result.session, parsed.data),
    );
  });
}

/**
 * Drops the cache for a group that has just gained a member.
 *
 * `joinFromLink` cannot do this itself — it is a domain module, and
 * `revalidatePath` is framework vocabulary — so the boundary does it on the
 * id that came back.
 */
function revalidateJoined(result: CodeAuthResult): CodeAuthResult {
  if (result.joinedGroupId) revalidatePath(`/groups/${result.joinedGroupId}`);
  return result;
}
