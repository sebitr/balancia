import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AddExpenseBar } from "@/components/dashboard/add-expense-bar";
import {
  GroupList,
  type GroupRowView,
} from "@/components/dashboard/group-list";
import { PositionHeader } from "@/components/dashboard/position-header";
import { getCurrentUser } from "@/lib/security/actor";
import {
  loadHomeOverview,
  type GroupPosition,
} from "@/modules/balances/overview";
import { getUserPreferredCurrency } from "@/modules/auth/service";
import { todayIso } from "@/modules/currencies/provider";

/**
 * Home: where you stand, then which group needs you, then a way in.
 *
 * Everything is resolved here, on the server. The list is handed to a client
 * component only so its search box can filter without a round trip, so the
 * view models below are plain serialisable values — amounts as minor-unit
 * strings, never as JS numbers.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("metaTitle") };
}

/**
 * One row.
 *
 * A group's own currency is what its row shows — `CHF 210.00` stays CHF even
 * where the header totals in EUR. The exception is a group holding balances in
 * several currencies at once, which collapses to its converted net; without a
 * rate to do that with, every figure is shown rather than one of them.
 */
function toRow(position: GroupPosition): GroupRowView {
  const amounts =
    position.amounts.length > 1 && position.net
      ? [position.net]
      : position.amounts;

  return {
    id: position.group.id,
    name: position.group.name,
    memberNames: [...position.group.memberNames],
    participantCount: position.group.participantCount,
    lastActivityAt: position.group.lastActivityAt.toISOString(),
    amounts: amounts.map((amount) => ({
      minorUnits: amount.amount.toString(),
      currency: amount.currency,
    })),
  };
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  // The layout has already redirected when there is no user.
  if (!user) return null;

  const t = await getTranslations("dashboard");
  const preferredCurrency = await getUserPreferredCurrency(user.userId);
  const now = new Date();
  const overview = await loadHomeOverview(user.userId, {
    preferredCurrency,
    now,
  });
  const { buckets, netPosition } = overview;

  if (overview.groupCount === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
        action={
          <Button asChild>
            <Link href="/groups/new">
              <Plus aria-hidden="true" />
              {t("createGroup")}
            </Link>
          </Button>
        }
      />
    );
  }

  // The picker is ordered by recency rather than by urgency: "which group am I
  // in right now" is the question it answers. Archived groups are left out.
  const pickable = [
    ...buckets.youOwe,
    ...buckets.youAreOwed,
    ...buckets.settled,
  ]
    .sort(
      (a, b) =>
        b.group.lastActivityAt.getTime() - a.group.lastActivityAt.getTime(),
    )
    .map((position) => ({
      id: position.group.id,
      name: position.group.name,
      lastActivityAt: position.group.lastActivityAt.toISOString(),
    }));

  return (
    // The negative margins cancel the shell's own vertical padding so the
    // position header and the action bar can reach the edges of the column.
    <div className="-mt-6 -mb-6 flex min-h-[calc(100dvh-3.5rem)] flex-col">
      <h1 className="sr-only">{t("title")}</h1>

      <PositionHeader
        net={
          netPosition
            ? {
                minorUnits: netPosition.net.amount.toString(),
                currency: netPosition.net.currency,
              }
            : null
        }
        owedToYou={
          netPosition
            ? {
                minorUnits: netPosition.owedToYou.amount.toString(),
                currency: netPosition.owedToYou.currency,
              }
            : null
        }
        youOwe={
          netPosition
            ? {
                minorUnits: netPosition.youOwe.amount.toString(),
                currency: netPosition.youOwe.currency,
              }
            : null
        }
        owedGroupCount={netPosition?.owedGroupCount ?? 0}
        owingGroupCount={netPosition?.owingGroupCount ?? 0}
        currencyTotals={overview.currencyTotals.map((total) => ({
          currency: total.currency,
          owedToYou: total.owedToYou.amount.toString(),
          youOwe: total.youOwe.amount.toString(),
        }))}
        displayCurrency={overview.displayCurrency}
        ratesAsOf={overview.ratesAsOf}
        today={todayIso(now)}
        converted={overview.converted}
      />

      <div className="flex-1 pt-4">
        <GroupList
          youOwe={buckets.youOwe.map(toRow)}
          youAreOwed={buckets.youAreOwed.map(toRow)}
          settled={buckets.settled.map(toRow)}
          archived={buckets.archived.map(toRow)}
          now={now.toISOString()}
        />
      </div>

      <AddExpenseBar groups={pickable} now={now.toISOString()} />
    </div>
  );
}
