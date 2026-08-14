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
 * The codes the Apple callback may redirect back with.
 *
 * An allowlist, not a lookup: `?error=` arrives from the address bar as
 * readily as from the callback, and without this anyone could choose which of
 * the app's server messages to display on its sign-in page.
 */
const APPLE_ERROR_CODES = new Set([
  "appleFailed",
  "appleExpired",
  "appleNoEmail",
  "appleEmailTaken",
  "appleLinkedElsewhere",
  "registrationClosed",
  "invalidCredentials",
  "rateLimited",
  "generic",
]);

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  if (await getCurrentUser()) {
    redirect("/dashboard");
  }

  const env = getEnv();
  const { error } = await searchParams;
  const code = typeof error === "string" ? error : undefined;

  let initialError: string | null = null;
  if (code && APPLE_ERROR_CODES.has(code)) {
    const t = await getTranslations("serverErrors");
    const key = code as Parameters<typeof t.has>[0];
    initialError = t.has(key) ? t(key) : t("generic");
  }

  return (
    <SignInForm
      mailEnabled={env.smtpEnabled}
      appleEnabled={env.appleSignInEnabled}
      initialError={initialError}
    />
  );
}
