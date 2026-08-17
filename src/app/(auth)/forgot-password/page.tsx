import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { getCurrentUser } from "@/lib/security/actor";
import { getEnv } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("forgotPassword");
  return { title: t("metaTitle") };
}

export default async function ForgotPasswordPage() {
  // Somebody who is already in does not need to recover anything.
  if (await getCurrentUser()) {
    redirect("/dashboard");
  }

  // The sign-in page hides the link to this one when there is no mail server,
  // but the address can still be typed, and an empty form that fails on submit
  // is a worse answer than saying so.
  if (!getEnv().smtpEnabled) {
    const t = await getTranslations("forgotPassword");
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("unavailableTitle")}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {t("unavailableBody")}
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">{t("backToSignIn")}</Link>
        </Button>
      </div>
    );
  }

  return <ForgotPasswordForm />;
}
