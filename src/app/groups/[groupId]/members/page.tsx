import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { InviteLinkCard } from "@/components/groups/invite-link-card";
import { PeopleCard, type PersonView } from "@/components/members/people-card";
import { peopleLedger } from "@/components/members/people-ledger";
import { inReadingOrder } from "@/components/members/reading-order";
import { requireGroupAccess } from "@/lib/actions";
import { describeJoinLink } from "@/lib/security/join-link";
import { cn } from "@/lib/utils";
import { loadGroupBalances } from "@/modules/balances/service";
import {
  listParticipants,
  type ParticipantSummary,
} from "@/modules/groups/service";
import { listRemindRecipients } from "@/modules/reminders/service";

/**
 * Who shares the expenses in this group.
 *
 * One card, one row per person, and everything a row can do folded inside it:
 * renaming, the personal link for someone with no account, and removal. The three
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
 *
 * From `lg` up the same people are a table (`PeopleTable`, inside the card):
 * what each paid and what their share came to, where they stand, Remind for
 * whoever owes the reader, and a menu holding the phone's open row. Those
 * figures come off the balances already loaded here, so the table costs the
 * phone nothing but the reminder list, which is empty — and free — for a
 * reader nobody owes. The group link stands beside the table once the screen
 * has room for both, and under it until then.
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
  const [participants, balances, joinLink, recipients] = await Promise.all([
    listParticipants(access.groupId),
    loadGroupBalances(access),
    invites ? describeJoinLink(access.groupId) : null,
    // The same list the settle screen's Remind reads; it shares this render's
    // balances rather than reading them again.
    listRemindRecipients(access),
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

  /*
   * Addresses are for the people who signed in, never for a guest link.
   *
   * A link is a bearer credential that gets forwarded, and the address on a
   * row is the owner's sign-in address or one somebody typed for a person who
   * is not on the app — neither is the business of whoever the link reached.
   * Everything a guest reader needs from a row survives without it: the name,
   * and whether they have an account, which `access` below already says.
   */
  const showsEmail = access.actor.kind !== "guest";

  const unordered: PersonView[] = participants.map((participant) => ({
    id: participant.id,
    name: participant.displayName,
    email: showsEmail ? (participant.email ?? "") : "",
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
  /*
   * The same promise without the finger, from `lg` up: there a click on a
   * person opens their page, and what the phone's tap opens is in the menu
   * at the end of their row. The read-only sentence makes no promise to
   * reword.
   */
  const introDesk =
    intro === "intro"
      ? "introDesk"
      : intro === "introMember"
        ? "introMemberDesk"
        : intro;

  const ledger = peopleLedger(
    balances.spendingFacts,
    participants.map((participant) => participant.id),
    access.group.currencyMode === "converted"
      ? access.group.baseCurrency
      : null,
  );

  const senderName =
    access.actor.kind === "guest"
      ? access.actor.displayName
      : access.actor.name;

  /*
   * The group link stands beside the table once the screen holds both, which
   * is a question about the screen's own width rather than the window's: the
   * sidebar beside it can be folded at any window size. From 64rem of screen
   * the table keeps about 680px and every column but Share; under that the
   * card goes under the table, as the design's 1024px board has it. Placed by
   * the grid alone and never moved in the document, so a phone, a screen
   * reader and a keyboard all keep the order they had.
   *
   * `data-layout="wide"` is what asks the screen for the room (see `Screen`).
   */
  const main = "lg:@min-[64rem]:col-start-1";

  return (
    <div data-layout="wide" className="lg:@container">
      <div
        className={cn(
          "flex flex-col gap-[18px]",
          invites &&
            "lg:@min-[64rem]:grid lg:@min-[64rem]:grid-cols-[minmax(0,1fr)_20rem] lg:@min-[64rem]:grid-rows-[auto_auto_1fr] lg:@min-[64rem]:items-start lg:@min-[64rem]:gap-x-6",
        )}
      >
        <div className={cn("flex flex-col gap-2", main)}>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-pretty text-muted-foreground lg:hidden">
            {t(intro)}
          </p>
          <p className="hidden text-pretty text-muted-foreground lg:block">
            {t(introDesk)}
          </p>
        </div>

        <div className={main}>
          <PeopleCard
            groupId={access.groupId}
            groupName={access.group.name}
            archived={access.group.archivedAt !== null}
            people={people}
            viewerId={access.participantId}
            canManage={access.permissions.manageParticipants}
            canInvite={access.permissions.manageInvitations}
            canRemove={access.permissions.removeParticipants}
            canLeave={access.permissions.leaveGroup}
            ledger={ledger}
            recipients={recipients}
            senderName={senderName}
          />
        </div>

        {invites && (
          <div className="lg:@min-[64rem]:col-start-2 lg:@min-[64rem]:row-span-3 lg:@min-[64rem]:row-start-1">
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
          </div>
        )}

        <p className={cn("text-xs text-pretty text-muted-foreground", main)}>
          {t("footnote")}
        </p>
      </div>
    </div>
  );
}
