import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { getDateFormatter } from "@/i18n/preferences";
import { requireGroupAccess } from "@/lib/actions";
import { getCurrentActor } from "@/lib/security/actor";
import { getEnv } from "@/lib/env";
import { describeGuestSession } from "@/modules/guests/service";
import { loadGroupOverview } from "@/modules/groups/overview";
import { loadJoinSummary } from "@/modules/join/service";

/**
 * Where an invitation link lands.
 *
 * The token is already gone by the time this renders: `/join/[token]` spends
 * it, sets the session cookie and redirects here, so the address bar, history
 * and any referrer carry nothing. This screen reads that cookie and does the
 * introducing — who invited them, what the group is, what they are owed — and
 * then hands over to the onboarding flow.
 *
 * This is the *personal* arrival: the link was addressed to one person, so the
 * group already knows a name for them and there is nothing to identify. What
 * is left to ask is only how they want to be kept — an account, a sign-in, or
 * a guest session that stays in this browser. All three keep what the guest
 * session is already holding; none of them strands anything.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invite");
  return { title: t("metaTitle") };
}

export default async function InvitePage() {
  const actor = await getCurrentActor();
  // A signed-in reader has no guest identity to introduce, and someone with no
  // session at all reached this URL without a link.
  if (actor?.kind === "user") redirect("/dashboard");
  if (!actor) redirect("/join/error?reason=invalid");

  const access = await requireGroupAccess(actor.groupId);
  const [overview, invitation, summary] = await Promise.all([
    loadGroupOverview(access),
    describeGuestSession(actor.sessionId),
    loadJoinSummary(actor.groupId),
  ]);

  const dates = await getDateFormatter();
  const env = getEnv();

  // One currency, one position: the case a sentence can carry. A group kept in
  // several is shown its largest, which is the one worth losing sleep over.
  const position = overview.positions[0] ?? null;

  return (
    <OnboardingFlow
      arrival="personal"
      inviterName={invitation.inviterName}
      knownName={actor.displayName}
      registrationAllowed={env.ALLOW_REGISTRATION}
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
        // The settle-up prompt reads a payout method that does not exist in
        // the schema yet, so nothing raises one here.
        settleRequest: null,
      }}
    />
  );
}
