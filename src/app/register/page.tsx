import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { getDateFormatter } from "@/i18n/preferences";
import { requireGroupAccess } from "@/lib/actions";
import { loadGroupOverview } from "@/modules/groups/overview";
import { loadJoinSummary } from "@/modules/join/service";
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

  /*
   * A guest who came here to stop being one.
   *
   * They are not a cold arrival, whatever the URL says: there is a group
   * behind them, a balance in it and expenses filed under their name, and all
   * of that is what an account keeps. So they get the arrival that has a group
   * card on it and ends on the group — minus the guest option, which is what
   * they already have. The claim itself happens the moment a session exists;
   * see `claimGuestIdentity`.
   */
  if (actor?.kind === "guest") {
    const access = await requireGroupAccess(actor.groupId);
    const [overview, summary] = await Promise.all([
      loadGroupOverview(access),
      loadJoinSummary(actor.groupId),
    ]);
    const dates = await getDateFormatter();
    const position = overview.positions[0] ?? null;

    return (
      <OnboardingFlow
        arrival="personal"
        knownName={actor.displayName}
        alreadyGuest
        registrationAllowed
        codeSignupAvailable={env.smtpEnabled}
        group={{
          groupId: access.groupId,
          summary: {
            groupName: summary.groupName,
            participantCount: summary.participantCount,
            expenseCount: summary.expenseCount,
            since: summary.since ? dates.plain(summary.since) : null,
            totals: summary.totals.map((total) => ({
              currency: total.currency,
              minorUnits: total.amount.toString(),
            })),
            faces: summary.faces.map((face) => face.displayName),
          },
          position: position
            ? {
                currency: position.currency,
                minorUnits: position.amount.toString(),
              }
            : null,
          settleRequest: null,
        }}
      />
    );
  }

  return (
    <OnboardingFlow
      arrival="cold"
      group={null}
      registrationAllowed
      codeSignupAvailable={env.smtpEnabled}
      /*
       * Not `redirect("/dashboard")`, which is what this was.
       *
       * Halfway through the flow an account exists, and the next Server Action
       * re-renders this page with a signed-in actor — so the redirect fired on
       * success and replaced somebody's own arrival screen with the dashboard.
       * The flow acts on this once, when it mounts.
       */
      account={
        actor?.kind === "user" ? { name: actor.name, email: actor.email } : null
      }
    />
  );
}
