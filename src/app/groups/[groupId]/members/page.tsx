import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { InviteLinkCard } from "@/components/groups/invite-link-card";
import { PeopleCard, type PersonView } from "@/components/members/people-card";
import { inReadingOrder } from "@/components/members/reading-order";
import { requireGroupAccess } from "@/lib/actions";
import { describeJoinLink } from "@/lib/security/join-link";
import { loadGroupBalances } from "@/modules/balances/service";
import {
  listParticipants,
  type ParticipantSummary,
} from "@/modules/groups/service";

/**
 * Who shares the expenses in this group.
 *
 * One card, one row per person, and everything a row can do folded inside it:
 * renaming, the invite link for someone with no account, and removal. The three
 * used to be three separate blocks stacked under each name, which read as three
 * unrelated features rather than as one person's settings.
 *
 * This Server Component owns the facts and the client island below owns which
 * row is open. Balances are loaded for one reason only — a person who still
 * owes money should not be quietly removed — so they arrive as minor-unit
 * strings per currency and are never collapsed into a single number.
 *
 * The group-wide link is below the list, the same card settings shows and the
 * same one object behind it. Settings is where it is *administered*; this is
 * where the question that reaches for it gets asked — a row saying somebody
 * has no account yet is the whole reason anyone wants the link — and sending
 * a reader to another screen to answer it was two taps for the one thing the
 * two screens have in common.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("membersPage");
  return { title: t("title") };
}

/** Which of the three access states a person is in. */
function accessOf(participant: ParticipantSummary): PersonView["access"] {
  if (participant.userId) return "account";
  return participant.hasActiveInvitation ? "link" : "none";
}

export default async function MembersPage({
  params,
}: PageProps<"/groups/[groupId]/members">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  // The link is read only for the readers who could do anything with it; the
  // rest of the group pays nothing for a card they are not shown.
  const invites = access.permissions.manageInvitations;
  const [participants, balances, joinLink] = await Promise.all([
    listParticipants(access.groupId),
    loadGroupBalances(access),
    invites ? describeJoinLink(access.groupId) : null,
  ]);

  /*
   * Every currency this person is not square in. A group can hold balances in
   * several at once, so this is a list: "settle up first" has to name all of
   * what is outstanding, not whichever currency happened to sort first.
   */
  const outstanding = new Map<
    string,
    { minorUnits: string; currency: string }[]
  >();
  for (const entry of balances.currencies) {
    for (const balance of entry.balances) {
      if (balance.amount === 0n) continue;
      const list = outstanding.get(balance.participantId) ?? [];
      list.push({
        minorUnits: balance.amount.toString(),
        currency: entry.currency,
      });
      outstanding.set(balance.participantId, list);
    }
  }

  const unordered: PersonView[] = participants.map((participant) => ({
    id: participant.id,
    name: participant.displayName,
    email: participant.email ?? "",
    isOwner: participant.role === "owner",
    access: accessOf(participant),
    link:
      participant.hasActiveInvitation && participant.invitationCreatedAt
        ? {
            createdAt: participant.invitationCreatedAt.toISOString(),
            expiresAt: participant.invitationExpiresAt?.toISOString() ?? null,
            lastUsedAt: participant.invitationLastUsedAt?.toISOString() ?? null,
          }
        : null,
    balances: outstanding.get(participant.id) ?? [],
  }));

  const [t, locale] = await Promise.all([
    getTranslations("membersPage"),
    getLocale(),
  ]);
  const people = inReadingOrder(unordered, access.participantId, locale);

  /*
   * The intro promises whatever this reader can actually do, which is three
   * different sentences: the owner renames, invites and removes; a member fixes
   * names and is told who to ask about the rest; a guest is reading a list.
   * Promising all three to everyone would have two thirds of the group tapping
   * rows to find out the offer was not theirs.
   */
  const intro = invites
    ? "intro"
    : access.permissions.manageParticipants
      ? "introMember"
      : "introReadOnly";

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-pretty text-muted-foreground">{t(intro)}</p>
      </div>

      <PeopleCard
        groupId={access.groupId}
        people={people}
        viewerId={access.participantId}
        canManage={access.permissions.manageParticipants}
        canInvite={access.permissions.manageInvitations}
        canRemove={access.permissions.removeParticipants}
      />

      {invites && (
        <InviteLinkCard
          groupId={access.groupId}
          groupName={access.group.name}
          link={
            joinLink
              ? {
                  status: joinLink.status,
                  url: joinLink.url,
                  expiresAt: joinLink.expiresAt?.toISOString() ?? null,
                }
              : null
          }
          // The card's line about people without an account is a way *here*,
          // and the list it points at is directly above. Counting them again
          // under it would be the same screen offering to show itself.
          unclaimedCount={0}
          // One instant for the whole render, so the card's "In 6 days" is a
          // subtraction the browser can repeat and get the same answer.
          now={new Date().toISOString()}
        />
      )}

      <p className="text-xs text-pretty text-muted-foreground">
        {t("footnote")}
      </p>
    </div>
  );
}
