import { after } from "next/server";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { BalanceList } from "@/components/groups/balance-list";
import { GroupEmptyState } from "@/components/groups/group-empty-state";
import { PositionHero } from "@/components/groups/position-hero";
import { SettlementList } from "@/components/groups/settlement-list";
import { SpendingCard } from "@/components/groups/spending-card";
import { SinceLastOpened } from "@/components/activity/since-last-opened";
import { GuestAccountWidget } from "@/components/guests/guest-account-widget";
import { requireGroupAccess } from "@/lib/actions";
import { listGroupActivity } from "@/modules/activity/service";
import { countContributions } from "@/modules/guests/service";
import { listParticipants } from "@/modules/groups/service";
import {
  loadGroupOverview,
  markGroupOpened,
  type CurrencyPosition,
} from "@/modules/groups/overview";
import { listRemindRecipients } from "@/modules/reminders/service";

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

export default async function GroupOverviewPage({
  params,
}: PageProps<"/groups/[groupId]">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  const isGuest = access.role === "guest";
  const now = new Date();

  const [overview, activity, recipients, contributionCount, participants] =
    await Promise.all([
      loadGroupOverview(access, { now }),
      listGroupActivity(access.groupId, { limit: ACTIVITY_ROWS }),
      listRemindRecipients(access),
      // Only the guest widget names this number, so only a guest pays for it.
      isGuest && access.participantId
        ? countContributions(access.participantId)
        : Promise.resolve(0),
      listParticipants(access.groupId),
    ]);

  const t = await getTranslations("group");

  // Read during the render, used after it: the value the reader has just been
  // shown is the boundary, and it may only move once they have seen it.
  const participantId = access.participantId;
  if (participantId) {
    after(async () => {
      await markGroupOpened(participantId);
    });
  }

  const empty = overview.expenseCount === 0;
  const guestPosition = isGuest ? strongestPosition(overview.positions) : null;

  const senderName =
    access.actor.kind === "guest"
      ? access.actor.displayName
      : access.actor.name;
  const participantOptions = participants.map((participant) => ({
    id: participant.id,
    displayName: participant.displayName,
  }));

  return (
    <div className="flex flex-col gap-[26px]">
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

      {empty ? (
        <GroupEmptyState
          groupId={groupId}
          canImport={access.permissions.importData}
          canInvite={access.permissions.manageInvitations}
        />
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
              participants={participantOptions}
              currencyMode={access.group.currencyMode}
              baseCurrency={access.group.baseCurrency}
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
            participants={participantOptions}
            currencyMode={access.group.currencyMode}
            baseCurrency={access.group.baseCurrency}
          />

          {activity.length > 0 && (
            <SinceLastOpened
              entries={activity}
              lastOpenedAt={overview.lastOpenedAt?.toISOString() ?? null}
              groupId={groupId}
              now={now.toISOString()}
            />
          )}

          <SpendingCard
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
