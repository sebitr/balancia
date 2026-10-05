import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SignInForm } from "@/components/auth/sign-in-form";
import { getCurrentUser } from "@/lib/security/actor";
import { getEnv } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signIn");
  return { title: t("metaTitle") };
}

/**
 * The codes a redirect may hand this page.
 *
 * An allowlist, not a lookup: `?error=` arrives from the address bar as
 * readily as from the Apple callback or a link in an email, and without this
 * anyone could choose which of the app's server messages to display on its
 * sign-in page.
 */
const SIGN_IN_ERROR_CODES = new Set([
  "appleFailed",
  "appleExpired",
  "appleNoEmail",
  "appleEmailTaken",
  "appleLinkedElsewhere",
  "registrationClosed",
  "invalidCredentials",
  "confirmLinkInvalid",
  "rateLimited",
  "generic",
]);

/**
 * What /confirm-email redirects here with when the browser that opened the
 * link has no session — which is the common case, the link having been read in
 * the new inbox. Only "changed" is good news; the rest are refusals whose
 * wording already exists for the signed-in path.
 */
const EMAIL_CHANGE_ERRORS: Record<string, string> = {
  invalid: "emailChangeLinkInvalid",
  taken: "emailTaken",
};

/**
 * Whether the reader was turned away from a group's page.
 *
 * The group shell sends anybody signed out here with `next=/groups/<id>`, and
 * the likeliest of them is not a member who forgot to sign in but somebody who
 * was sent the group's address — a reminder, a forwarded message — and has no
 * account at all. "Back to your groups" says nothing to them, so a line does.
 *
 * Decided from the shape of `next` alone, before and without any lookup: the
 * shell redirects for every id, real or not, so the line can say nothing about
 * whether the group exists or what it is called, and it does not.
 */
function cameFromGroupPage(next: string | string[] | undefined): boolean {
  return typeof next === "string" && /^\/groups\/[^/?#]+/.test(next);
}

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  if (await getCurrentUser()) {
    redirect("/dashboard");
  }

  const env = getEnv();
  const { error, verified, emailChange, next } = await searchParams;
  const code = typeof error === "string" ? error : undefined;
  const changeOutcome =
    typeof emailChange === "string" ? emailChange : undefined;

  const t = await getTranslations("serverErrors");
  const describe = (key: string): string => {
    const candidate = key as Parameters<typeof t.has>[0];
    return t.has(candidate) ? t(candidate) : t("generic");
  };

  let initialError: string | null = null;
  if (code && SIGN_IN_ERROR_CODES.has(code)) {
    initialError = describe(code);
  } else if (changeOutcome && changeOutcome in EMAIL_CHANGE_ERRORS) {
    initialError = describe(EMAIL_CHANGE_ERRORS[changeOutcome]);
  }

  // Both arrive from a link that has just been spent, so the person is on this
  // page having done something right; saying so is the difference between a
  // finished flow and an unexplained sign-in form.
  const tNotices = await getTranslations("auth.notices");
  const initialNotice =
    changeOutcome === "changed"
      ? tNotices("emailChanged")
      : verified === "1"
        ? tNotices("emailVerified")
        : null;

  return (
    <SignInForm
      mailEnabled={env.smtpEnabled}
      appleEnabled={env.appleSignInEnabled}
      initialError={initialError}
      initialNotice={initialNotice}
      privateGroup={cameFromGroupPage(next)}
      demoMode={env.DEMO_MODE}
    />
  );
}
