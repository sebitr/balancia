import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PeopleCard, type PersonView } from "@/components/members/people-card";
import { inReadingOrder } from "@/components/members/reading-order";
import { requireGroupAccess } from "@/lib/actions";
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

  const [participants, balances] = await Promise.all([
    listParticipants(access.groupId),
    loadGroupBalances(access),
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
    joinedAt: participant.createdAt.toISOString(),
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
  const intro = access.permissions.manageInvitations
    ? "intro"
    : access.permissions.manageParticipants
      ? "introMember"
      : "introReadOnly";

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-[1.6875rem] leading-[1.15] font-semibold tracking-[-0.025em]">
          {t("title")}
        </h1>
        <p className="text-pretty text-muted-foreground">{t(intro)}</p>
        <Summary people={people} />
      </div>

      <PeopleCard
        groupId={access.groupId}
        people={people}
        viewerId={access.participantId}
        canManage={access.permissions.manageParticipants}
        canInvite={access.permissions.manageInvitations}
        canRemove={access.permissions.removeParticipants}
      />

      <p className="text-xs text-pretty text-muted-foreground">
        {t("footnote")}
      </p>
    </div>
  );
}

/**
 * "3 people · 1 with an account · 1 invite live · 1 waiting on an invite".
 *
 * Only the states that actually occur are named — a group where everyone has an
 * account should not be told that nobody is waiting on an invite.
 */
async function Summary({ people }: { people: readonly PersonView[] }) {
  const t = await getTranslations("membersPage");
  const count = (state: PersonView["access"]) =>
    people.filter((person) => person.access === state).length;

  const parts = [t("countPeople", { count: people.length })];
  const withAccount = count("account");
  const live = count("link");
  const waiting = count("none");
  if (withAccount > 0) parts.push(t("countAccounts", { count: withAccount }));
  if (live > 0) parts.push(t("countLinks", { count: live }));
  if (waiting > 0) parts.push(t("countWaiting", { count: waiting }));

  return <p className="text-xs text-muted-foreground">{parts.join(" · ")}</p>;
}
