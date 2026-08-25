import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { RegisterForm } from "@/components/auth/register-form";
import { getCurrentActor } from "@/lib/security/actor";
import { getEnv } from "@/lib/env";

/**
 * Signing up with a password, for the case where neither of the other two works.
 *
 * `/register` leads with a passkey and falls back to a mailed code. Between
 * them they cover every browser on every instance but one combination: a
 * deployment with no mail server, read in a browser with no WebAuthn. This is
 * where that reader is sent, and it is the reason the password form still
 * exists at all.
 *
 * Not linked from anywhere else on purpose. A password is a thing to invent, a
 * thing to confirm and a thing to forget, and offering it beside a one-tap
 * passkey only invites somebody to pick it out of habit.
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
