import { after } from "next/server";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { BalanceList } from "@/components/groups/balance-list";
import { CurrencyBalances } from "@/components/groups/currency-balances";
import {
  GroupEmptyState,
  type StartHerePerson,
} from "@/components/groups/group-empty-state";
import { DraftRow } from "@/components/entries/draft-row";
import { PositionCard } from "@/components/groups/position-card";
import { PositionHero } from "@/components/groups/position-hero";
import { SettlementList } from "@/components/groups/settlement-list";
import { SpendingCard } from "@/components/groups/spending-card";
import { SinceLastOpened } from "@/components/activity/since-last-opened";
import { GuestAccountWidget } from "@/components/guests/guest-account-widget";
import { requireGroupAccess } from "@/lib/actions";
import { describeJoinLink } from "@/lib/security/join-link";
import type { GroupAccess } from "@/lib/security/authorization";
import { listGroupActivity } from "@/modules/activity/service";
import { listParticipants } from "@/modules/groups/service";
import { countContributions } from "@/modules/guests/service";
import {
  isMultiCurrency,
  loadGroupOverview,
  mainCurrencyOf,
  markGroupOpened,
  type CurrencyPosition,
} from "@/modules/groups/overview";
import { listRemindRecipients } from "@/modules/reminders/service";
import { cn } from "@/lib/utils";

/**
 * Group overview — where I stand, what this group is, who owes whom, and what
 * changed since I last looked.
 *
 * Configuration does not appear here. Currency mode and roles live on the
 * group's own settings page; this screen is for the money and the people. The
 * expense list is likewise gone: it has a tab of its own, and repeating five
 * rows of it here only competed with the position.
 */

/** The balance list stops here and hands the rest to the balances screen. */
const BALANCE_ROWS = 5;
/** Enough history to find the useful lines beyond a burst of recent edits. */
const ACTIVITY_ROWS = 12;

/**
 * The position the guest widget names.
 *
 * That widget puts one amount inside a sentence, so a group kept in several
 * currencies has to pick: the largest, which is the one worth losing sleep
 * over. Null when there is nothing to name yet.
 */
function strongestPosition(
  positions: readonly CurrencyPosition[],
): CurrencyPosition | null {
  const magnitude = (value: bigint) => (value < 0n ? -value : value);
  let strongest: CurrencyPosition | null = null;
  for (const position of positions) {
    if (
      !strongest ||
      magnitude(position.amount) > magnitude(strongest.amount)
    ) {
      strongest = position;
    }
  }
  return strongest;
}

/**
 * What "Start here" needs: who is in the group, and the link that lets one
 * more person in.
 *
 * The link is read only for a reader who could do anything with it, exactly as
 * the People tab does — the rest of the group pays nothing for a row they are
 * not shown. Only a live link comes back: an expired or revoked one is still
 * worth showing where it can be replaced, which is settings, and is worth
 * nothing at all in a row whose whole offer is "send this to somebody".
 */
async function loadStartHere(
  access: GroupAccess,
  { now }: { now: Date },
): Promise<{
  people: StartHerePerson[];
  invite: { url: string; expiresAt: string | null } | null;
}> {
  const [roster, link] = await Promise.all([
    listParticipants(access.groupId),
    access.permissions.manageInvitations
      ? describeJoinLink(access.groupId, { now })
      : null,
  ]);

  const people = roster.map((participant) => ({
    participantId: participant.id,
    name: participant.displayName,
    isSelf: participant.id === access.participantId,
  }));

  return {
    // Join order, except that the reader goes first: the stack and the names
    // line both start with the face the reader is looking for.
    people: people.sort((a, b) => Number(b.isSelf) - Number(a.isSelf)),
    invite:
      link?.status === "active" && link.url
        ? { url: link.url, expiresAt: link.expiresAt?.toISOString() ?? null }
        : null,
  };
}

export default async function GroupOverviewPage({
  params,
}: PageProps<"/groups/[groupId]">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  const isGuest = access.role === "guest";
  const now = new Date();

  // The roster used to be loaded here for the record-a-payment dialog the
  // settlement rows carried. Recording now happens in the add-entry drawer,
  // which loads the people it needs on its own route, so the overview no
  // longer pays for a list nothing on it reads.
  const [overview, activity, recipients, contributionCount] = await Promise.all(
    [
      loadGroupOverview(access, { now }),
      listGroupActivity(access.groupId, { limit: ACTIVITY_ROWS }),
      listRemindRecipients(access),
      // Only the guest widget names this number, so only a guest pays for it.
      isGuest && access.participantId
        ? countContributions(access.participantId)
        : Promise.resolve(0),
    ],
  );

  const t = await getTranslations("group");

  // Read during the render, used after it: the value the reader has just been
  // shown is the boundary, and it may only move once they have seen it.
  const participantId = access.participantId;
  if (participantId) {
    after(async () => {
      await markGroupOpened(participantId);
    });
  }

  /*
   * The roster and the group's guest link, for the empty screen only — and
   * so, non-null exactly when this group has no money in it yet, which is
   * what decides which of the two overviews below renders.
   *
   * The comment above the first load records that the roster was deliberately
   * taken off this page, and that reasoning still holds for every group with
   * money in it — nothing on the full overview reads a list of names. A group
   * with nothing in it is the exception: "who is here" and "send the link" are
   * the two things left to do, and the screen now does them rather than
   * pointing at the tab where they live.
   *
   * Loaded after the overview rather than beside it, because whether the
   * group is empty is the overview's own answer. That costs a second round
   * trip on the one screen where there is nothing else to wait for.
   */
  const startHere =
    overview.expenseCount === 0 ? await loadStartHere(access, { now }) : null;

  // Which of the two overviews this group gets, and why, is `isMultiCurrency`.
  const multiCurrency = isMultiCurrency(overview.currencies);
  const guestPosition = isGuest ? strongestPosition(overview.positions) : null;

  const senderName =
    access.actor.kind === "guest"
      ? access.actor.displayName
      : access.actor.name;
  return (
    <div
      className={cn("flex flex-col", multiCurrency ? "gap-5" : "gap-[26px]")}
    >
      {/* No visible title and no meta line: the switcher in the top bar
          already names the group, and counting people, expenses and days told
          the reader nothing they could act on. The heading stays for anyone
          navigating by structure, as on the dashboard. */}
      <h1 className="sr-only">{access.group.name}</h1>

      {/* What survives on screen is the state nothing else here reports. */}
      {(access.group.archivedAt || isGuest) && (
        <div className="flex flex-wrap items-center gap-2">
          {access.group.archivedAt && (
            <Badge variant="secondary">{t("archived")}</Badge>
          )}
          {isGuest && <Badge variant="outline">{t("guest")}</Badge>}
        </div>
      )}

      {/*
       * A half-written entry, if this device has one. Renders nothing when it
       * does not, which is almost always — see `DraftRow`.
       */}
      <DraftRow groupId={groupId} />

      {startHere ? (
        <GroupEmptyState
          groupId={groupId}
          groupName={access.group.name}
          canImport={access.permissions.importData}
          people={startHere.people}
          invite={startHere.invite}
          now={now.toISOString()}
        />
      ) : (
        <>
          {multiCurrency ? (
            <>
              {access.participantId && (
                <PositionCard
                  positions={overview.positions.map((position) => ({
                    currency: position.currency,
                    minorUnits: position.amount.toString(),
                    counterparties: position.counterparties.map((party) => ({
                      participantId: party.participantId,
                      name: party.name,
                      minorUnits: party.amount.toString(),
                    })),
                    breakdown: {
                      paid: position.breakdown.paid.toString(),
                      share: position.breakdown.share.toString(),
                      revenueReceived:
                        position.breakdown.revenueReceived.toString(),
                      revenueCredited:
                        position.breakdown.revenueCredited.toString(),
                      settlementsPaid:
                        position.breakdown.settlementsPaid.toString(),
                      settlementsReceived:
                        position.breakdown.settlementsReceived.toString(),
                      otherAdjustments:
                        position.breakdown.otherAdjustments.toString(),
                    },
                  }))}
                  groupId={groupId}
                  groupName={access.group.name}
                  senderName={senderName}
                  recipients={recipients}
                />
              )}

              <CurrencyBalances
                currencies={overview.currencies.map((entry) => ({
                  currency: entry.currency,
                  totalSpent: entry.totalSpent.toString(),
                  position: entry.position.toString(),
                  members: entry.members.map((member) => ({
                    participantId: member.participantId,
                    name: member.name,
                    minorUnits: member.amount.toString(),
                    isSelf: member.isSelf,
                  })),
                  transfers: entry.transfers.map((transfer) => ({
                    fromParticipantId: transfer.fromParticipantId,
                    fromName: transfer.fromName,
                    toParticipantId: transfer.toParticipantId,
                    toName: transfer.toName,
                    minorUnits: transfer.amount.toString(),
                    fromIsSelf: transfer.fromIsSelf,
                    toIsSelf: transfer.toIsSelf,
                  })),
                }))}
                groupId={groupId}
                groupName={access.group.name}
                senderName={senderName}
                recipients={recipients}
                participantCount={overview.participantCount}
                defaultOpen={mainCurrencyOf(
                  overview.currencies,
                  access.group.baseCurrency,
                )}
              />
            </>
          ) : (
            <>
              {access.participantId && (
                <PositionHero
                  positions={overview.positions.map((position) => ({
                    currency: position.currency,
                    minorUnits: position.amount.toString(),
                    counterparties: position.counterparties.map((party) => ({
                      participantId: party.participantId,
                      name: party.name,
                      minorUnits: party.amount.toString(),
                    })),
                    breakdown: {
                      paid: position.breakdown.paid.toString(),
                      share: position.breakdown.share.toString(),
                      revenueReceived:
                        position.breakdown.revenueReceived.toString(),
                      revenueCredited:
                        position.breakdown.revenueCredited.toString(),
                      settlementsPaid:
                        position.breakdown.settlementsPaid.toString(),
                      settlementsReceived:
                        position.breakdown.settlementsReceived.toString(),
                      otherAdjustments:
                        position.breakdown.otherAdjustments.toString(),
                    },
                  }))}
                  groupId={groupId}
                  groupName={access.group.name}
                  senderName={senderName}
                  recipients={recipients}
                  canArchive={
                    access.permissions.manageGroupSettings &&
                    access.group.archivedAt === null
                  }
                />
              )}

              {overview.rows.length > 0 && (
                <BalanceList
                  rows={overview.rows.map((row) => ({
                    participantId: row.participantId,
                    name: row.name,
                    currency: row.currency,
                    minorUnits: row.amount.toString(),
                    isSelf: row.isSelf,
                    remindedAt: null,
                  }))}
                  groupId={groupId}
                  limit={BALANCE_ROWS}
                  participantCount={overview.participantCount}
                />
              )}

              <SettlementList
                suggestions={overview.suggestions.map((suggestion) => ({
                  fromParticipantId: suggestion.fromParticipantId,
                  fromName: suggestion.fromName,
                  toParticipantId: suggestion.toParticipantId,
                  toName: suggestion.toName,
                  currency: suggestion.currency,
                  minorUnits: suggestion.amount.toString(),
                  fromIsSelf: suggestion.fromIsSelf,
                  toIsSelf: suggestion.toIsSelf,
                }))}
                groupId={groupId}
                groupName={access.group.name}
                senderName={senderName}
                recipients={recipients}
              />
            </>
          )}

          {activity.length > 0 && (
            <SinceLastOpened
              entries={activity}
              lastOpenedAt={overview.lastOpenedAt?.toISOString() ?? null}
              groupId={groupId}
              now={now.toISOString()}
            />
          )}

          <SpendingCard
            compact={multiCurrency}
            groupId={groupId}
            periods={overview.spendingPeriods.map((period) => ({
              key: period.key,
              stats: period.stats.map((stat) => ({
                currency: stat.currency,
                groupSpent: stat.groupSpent.toString(),
                youPaid: stat.youPaid.toString(),
                yourShare: stat.yourShare.toString(),
              })),
            }))}
          />
        </>
      )}

      {/* Last, and only for a guest: what they would lose by closing this
          browser is the note to leave them on, not the one to open with. */}
      {isGuest && (
        <GuestAccountWidget
          groupName={access.group.name}
          balance={
            guestPosition
              ? {
                  minorUnits: guestPosition.amount.toString(),
                  currency: guestPosition.currency,
                }
              : null
          }
          contributionCount={contributionCount}
        />
      )}
    </div>
  );
}
