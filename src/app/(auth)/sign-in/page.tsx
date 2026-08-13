import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { getCurrentUser } from "@/lib/security/actor";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await getCurrentUser()) {
    redirect("/dashboard");
  }
  return <SignInForm mailEnabled={getEnv().smtpEnabled} />;
}
