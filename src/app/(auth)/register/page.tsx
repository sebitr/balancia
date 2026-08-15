import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RegisterForm } from "@/components/auth/register-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getCurrentActor } from "@/lib/security/actor";
import { getEnv } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("register");
  return { title: t("metaTitle") };
}

export default async function RegisterPage() {
  const actor = await getCurrentActor();
  if (actor?.kind === "user") {
    redirect("/dashboard");
  }

  const env = getEnv();
  if (!env.ALLOW_REGISTRATION) {
    const t = await getTranslations("register");
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("closedTitle")}
        </h1>
        <Alert>
          <AlertDescription>{t("closedBody")}</AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">{t("goToSignIn")}</Link>
        </Button>
      </div>
    );
  }

  // A guest arrives with a name the group already uses for them; asking for it
  // again would only invite a second spelling of the same person.
  return (
    <RegisterForm
      appleEnabled={env.appleSignInEnabled}
      guestName={actor?.kind === "guest" ? actor.displayName : null}
    />
  );
}
