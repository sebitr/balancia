import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveJoinLink } from "@/lib/security/join-link";
import { readJoinCookie } from "@/modules/auth/cookies";
import { getCurrentUser } from "@/lib/security/actor";
import { loadProfileSetup } from "@/modules/profile/setup";
import { getDateFormatter } from "@/i18n/preferences";
import { listClaimableMembers, loadJoinSummary } from "@/modules/join/service";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { getEnv } from "@/lib/env";

/**
 * Where a group join link lands, once its token has left the URL.
 *
 * The authority for everything below is the cookie, not the reader: whoever
 * opened the link may be signed in or nobody at all, and either way the group
 * being shown is whichever group the link resolves to. All the deciding
 * happens on the client from here — the screens are a state machine over data
 * this page loads once — and only the final step comes back to the server.
 *
 * Loading the whole claimable list up front is deliberate. It is bounded by
 * the group's size, the matching runs against it as the reader types, and
 * asking the server per keystroke would leak the typed name into the logs of
 * a flow whose entire purpose is to handle it carefully.
 *
 * **This page never redirects, and that is load-bearing.** Finishing the flow
 * is a Server Action, and every Server Action re-renders the page it was
 * called from — by which time the join cookie has been spent and deliberately
 * cleared. A `redirect()` here would therefore fire on success and replace the
 * reader's "you're in" screen with a dead-link page. Instead the failure is
 * passed down as `linkGone`, rendered by the *same* component so React keeps
 * the client state, and a flow that has already finished simply ignores it.
 * Whoever arrives without a usable cookie sees the dead-link screen; whoever
 * just finished sees what they earned.
 *
 * A reader who was already signed in gets these same screens, which is the one
 * thing this page does that its personal-invitation sibling does not. They are
 * not a stranger to be turned away — they are the person the link was shared
 * with, holding an account already, so the only question left is which of the
 * listed names is theirs. `account` is what tells the flow to drop the
 * credential half of the route; `/join/g/[token]` has already sent anybody who
 * is *in* the group to the group itself, so nobody reaching here is a member.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("joinGroup");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default async function JoinStartPage() {
  let link: Awaited<ReturnType<typeof resolveJoinLink>> | null = null;
  try {
    link = await resolveJoinLink(await readJoinCookie());
  } catch {
    link = null;
  }

  /*
   * A link that no longer resolves.
   *
   * Passed down rather than redirected on, and that is load-bearing: finishing
   * this flow is a Server Action, every Server Action re-renders the page it
   * was called from, and by then the join cookie has been spent and cleared.
   * A `redirect()` here would therefore fire on *success* and replace the
   * reader's "you're in" screen with a dead-link page. The same component
   * renders both, so React keeps the client state, and a flow that has already
   * finished ignores the news entirely.
   */
  if (!link) return <OnboardingFlow arrival="shared" group={null} linkGone />;

  const viewer = await getCurrentUser();

  const [summary, claimable, profile] = await Promise.all([
    loadJoinSummary(link.groupId),
    listClaimableMembers(link.groupId),
    // What they have set up already, so the checklist at the end starts from
    // it — and disappears when there is nothing on it left to do.
    viewer ? loadProfileSetup(viewer.userId) : null,
  ]);

  const dates = await getDateFormatter();

  const env = getEnv();

  return (
    <OnboardingFlow
      arrival="shared"
      inviterName={link.inviterName}
      account={viewer && { name: viewer.name, email: viewer.email }}
      profile={profile}
      registrationAllowed={env.ALLOW_REGISTRATION}
      codeSignupAvailable={env.smtpEnabled}
      group={{
        // Null until the account is in the group, which happens at the end of
        // the flow: a shared link carries no membership of its own.
        groupId: null,
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
        // The reader has no position of their own yet — the one they may
        // inherit belongs to the member they are about to claim, and travels
        // on that member rather than on the group.
        position: null,
        settleRequest: null,
      }}
      members={claimable.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        expenseCount: member.expenseCount,
        balances: member.balances.map((balance) => ({
          currency: balance.currency,
          minorUnits: balance.amount.toString(),
        })),
        recentExpenses: member.recentExpenses.map((expense) => ({
          id: expense.id,
          description: expense.description,
          minorUnits: expense.amount.toString(),
          currency: expense.currency,
        })),
      }))}
    />
  );
}
