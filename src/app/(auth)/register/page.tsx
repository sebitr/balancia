import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RegisterForm } from "@/components/auth/register-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/security/actor";
import { getEnv } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("register");
  return { title: t("metaTitle") };
}

export default async function RegisterPage() {
  if (await getCurrentUser()) {
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

  return <RegisterForm appleEnabled={env.appleSignInEnabled} />;
}
