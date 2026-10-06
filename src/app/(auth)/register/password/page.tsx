import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { RegisterForm } from "@/components/auth/register-form";
import { getCurrentActor } from "@/lib/security/actor";
import { getEnv } from "@/lib/env";

/**
 * Signing up with a password, on a page of its own.
 *
 * `/register` leads with a passkey and falls back to a mailed code, and where
 * the instance has no mail server it now asks for the password on its own
 * Account step — see `components/onboarding/password-signup.tsx`. Nothing in
 * the app links here any more: this page dropped the reader out of the flow
 * they were in, and out of the group a link had brought them to.
 *
 * It stays for what still arrives by its address: the end-to-end journeys
 * make their accounts here (`tests/e2e/helpers.ts`), and it is the one sign-up
 * page that carries the Apple button. Retiring it means moving both first.
 *
 * Still not offered beside a passkey, and that part is on purpose. A password
 * is a thing to invent and a thing to forget, and offering it next to a
 * one-tap passkey only invites somebody to pick it out of habit.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("register");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default async function PasswordRegisterPage() {
  const actor = await getCurrentActor();
  if (actor?.kind === "user") redirect("/dashboard");

  const env = getEnv();
  if (!env.ALLOW_REGISTRATION) redirect("/register");

  return (
    <RegisterForm
      appleEnabled={env.appleSignInEnabled}
      // A guest arrives with a name the group already uses for them; asking
      // for it again would only invite a second spelling of the same person.
      guestName={actor?.kind === "guest" ? actor.displayName : null}
    />
  );
}
