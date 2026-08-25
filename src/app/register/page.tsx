import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";
import { getCurrentActor } from "@/lib/security/actor";
import { getEnv } from "@/lib/env";

/**
 * The cold arrival: somebody who found Balancia rather than being invited to it.
 *
 * It sits outside the `(auth)` group on purpose. That layout gives its
 * children a header, a wordmark and a `max-w-sm` column, and the flow brings
 * its own full-height shell with a progress header of its own — nested, the
 * two would draw two headers and two wordmarks on one phone screen.
 *
 * There is no group card here and no guest option, and neither absence is a
 * simplification. A cold arrival has no group to describe, and a guest session
 * is created by spending an invitation token and belongs to the group that
 * token came from — with no group, there is nothing to be a guest of.
 */

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
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-5">
        <Wordmark />
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

  return (
    <OnboardingFlow
      arrival="cold"
      group={null}
      // A guest who came here from an invitation arrives with a name the group
      // already uses for them; asking for it again would only invite a second
      // spelling of the same person.
      knownName={actor?.kind === "guest" ? actor.displayName : ""}
      registrationAllowed
      codeSignupAvailable={env.smtpEnabled}
    />
  );
}
