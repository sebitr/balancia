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

export default async function SignInPage() {
  if (await getCurrentUser()) {
    redirect("/dashboard");
  }
  return <SignInForm mailEnabled={getEnv().smtpEnabled} />;
}
