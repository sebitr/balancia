import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveJoinLink } from "@/lib/security/join-link";
import { readJoinCookie } from "@/modules/auth/cookies";
import { getDateFormatter } from "@/i18n/preferences";
import { listClaimableMembers, loadJoinSummary } from "@/modules/join/service";
import { JoinFlow } from "@/components/join/join-flow";

/**
 * Where a group join link lands, once its token has left the URL.
 *
 * The authority for everything below is the cookie, not the reader: nobody has
 * signed in, and the group being shown is whichever group the link resolves
 * to. All the deciding happens on the client from here — the screens are a
 * state machine over data this page loads once — and only the final step comes
 * back to the server.
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
 * just finished sees what they earned. Signed-in readers are turned away at
 * `/join/g/[token]`, before any of this, for the same reason.
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

  if (!link) return <JoinFlow linkGone />;

  const [summary, claimable] = await Promise.all([
    loadJoinSummary(link.groupId),
    listClaimableMembers(link.groupId),
  ]);

  const dates = await getDateFormatter();

  return (
    <JoinFlow
      summary={{
        groupName: summary.groupName,
        participantCount: summary.participantCount,
        expenseCount: summary.expenseCount,
        since: summary.since ? dates.plain(summary.since) : null,
        totals: summary.totals.map((total) => ({
          currency: total.currency,
          minorUnits: total.amount.toString(),
        })),
        faces: summary.faces.map((face) => face.displayName),
      }}
      inviterName={link.inviterName}
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
