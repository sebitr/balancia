import Link from "next/link";
import { after } from "next/server";
import { getTranslations } from "next-intl/server";
import { Plus, Receipt, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { BalanceList } from "@/components/groups/balance-list";
import { PositionCard } from "@/components/groups/position-card";
import { StatStrip } from "@/components/groups/stat-strip";
import { SinceLastOpened } from "@/components/activity/since-last-opened";
import { GuestAccountWidget } from "@/components/guests/guest-account-widget";
import { requireGroupAccess } from "@/lib/actions";
import { listGroupActivity } from "@/modules/activity/service";
import { countContributions } from "@/modules/guests/service";
import {
  loadGroupOverview,
  markGroupOpened,
  type CurrencyPosition,
} from "@/modules/groups/overview";
import { listRemindRecipients } from "@/modules/reminders/service";
import { PUSH } from "@/components/motion/transitions";

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
/** Four is enough to say "this moved"; the full history is a tap away. */
const ACTIVITY_ROWS = 4;

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

  const [overview, activity, recipients, contributionCount] = await Promise.all(
    [
      loadGroupOverview(access),
      listGroupActivity(access.groupId, { limit: ACTIVITY_ROWS }),
      listRemindRecipients(access),
      // Only the guest widget names this number, so only a guest pays for it.
      isGuest && access.participantId
        ? countContributions(access.participantId)
        : Promise.resolve(0),
    ],
  );

  const t = await getTranslations("group");
  const now = new Date();

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

  const remindedAt = new Map(
    recipients.map((recipient) => [
      recipient.participantId,
      recipient.lastRemindedAt,
    ]),
  );

  return (
    <div className="flex flex-col gap-5">
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

      {/* Before the first expense there is no position and no shape to frame:
          the empty state below is the whole screen, and a card of zeroes above
          it would only compete for the reader's first glance. */}
      {!empty && access.participantId && (
        <PositionCard
          positions={overview.positions.map((position) => ({
            currency: position.currency,
            minorUnits: position.amount.toString(),
            counterparties: position.counterparties.map((party) => ({
              name: party.name,
              minorUnits: party.amount.toString(),
            })),
          }))}
          groupId={groupId}
          groupName={access.group.name}
          senderName={
            access.actor.kind === "guest"
              ? access.actor.displayName
              : access.actor.name
          }
          recipients={recipients}
        />
      )}

      {!empty && (
        <StatStrip
          stats={overview.stats.map((stat) => ({
            currency: stat.currency,
            groupSpent: stat.groupSpent.toString(),
            youPaid: stat.youPaid.toString(),
            yourShare: stat.yourShare.toString(),
          }))}
        />
      )}

      {empty && (
        <EmptyState
          icon={Receipt}
          title={t("noExpensesTitle")}
          description={
            overview.participantCount > 1
              ? t("noExpensesDescription")
              : t("noExpensesDescriptionSolo")
          }
          action={
            /* Stacked and full width on a phone; only the primary action is
               filled, so the order to do things in survives a narrow column. */
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button asChild>
                {/* No direction, like the bar's own Add: this opens a drawer
                    over the group rather than going anywhere. */}
                <Link href={`/groups/${groupId}/expenses/new`}>
                  <Plus aria-hidden="true" />
                  {t("addExpense")}
                </Link>
              </Button>
              {access.permissions.manageParticipants && (
                <Button asChild variant="outline">
                  <Link
                    href={`/groups/${groupId}/members`}
                    transitionTypes={PUSH}
                  >
                    <Users aria-hidden="true" />
                    {t("addPeople")}
                  </Link>
                </Button>
              )}
              {access.permissions.importData && (
                <Button asChild variant="outline">
                  <Link
                    href={`/groups/${groupId}/import`}
                    transitionTypes={PUSH}
                  >
                    <Upload aria-hidden="true" />
                    {t("importFromSplitwise")}
                  </Link>
                </Button>
              )}
            </div>
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
            remindedAt: remindedAt.get(row.participantId) ?? null,
          }))}
          groupId={groupId}
          limit={BALANCE_ROWS}
          now={now.toISOString()}
        />
      )}

      {/* Omitted rather than shown empty: a heading over nothing is worse than
          no heading. */}
      {activity.length > 0 && (
        <SinceLastOpened
          entries={activity}
          lastOpenedAt={overview.lastOpenedAt?.toISOString() ?? null}
          groupId={groupId}
          now={now.toISOString()}
        />
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
