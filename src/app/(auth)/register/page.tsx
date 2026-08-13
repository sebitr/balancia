import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/security/actor";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await getCurrentUser()) {
    redirect("/dashboard");
  }

  const env = getEnv();
  if (!env.ALLOW_REGISTRATION) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Registration is closed
        </h1>
        <Alert>
          <AlertDescription>
            This Balancia instance does not accept new sign-ups. Ask the
            administrator for an account, or open a guest invitation link if
            someone shared one with you.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return <RegisterForm />;
}
