import Link from "next/link";
import {
  ArrowRightLeft,
  Coins,
  Plus,
  Receipt,
  Scale,
  Upload,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Amount, BalanceAmount, SettledBadge } from "@/components/money/amount";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { requireGroupAccess } from "@/lib/actions";
import { loadGroupBalances } from "@/modules/balances/service";
import { listGroupActivity } from "@/modules/activity/service";
import { listExpenses } from "@/modules/expenses/service";
import { listParticipants } from "@/modules/groups/service";

/**
 * Group overview — the screen that answers, at a glance:
 * total spending, who owes, who is owed, which currencies, recent activity,
 * and how to add an expense.
 */
export default async function GroupOverviewPage({
  params,
}: PageProps<"/groups/[groupId]">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  const [balances, activity, expenses, participants] = await Promise.all([
    loadGroupBalances(access),
    listGroupActivity(access.groupId, { limit: 8 }),
    listExpenses(access.groupId, { limit: 5 }),
    listParticipants(access.groupId),
  ]);

  const hasActivity = expenses.length > 0;
  const myParticipantId = access.participantId;
  const participantCount = participants.length;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {access.group.name}
          </h1>
          {access.group.archivedAt && (
            <Badge variant="secondary">Archived</Badge>
          )}
          {access.role === "guest" && <Badge variant="outline">Guest</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {access.group.currencyMode === "converted"
            ? `Everything converted to ${access.group.baseCurrency}`
            : "Each currency balanced separately"}
        </p>
      </header>

      {!hasActivity ? (
        <EmptyState
          icon={Receipt}
          title="No expenses yet"
          description={
            participantCount > 1
              ? "Add the first expense and Balancia will start working out who owes whom."
              : "Add the people sharing these costs, then record the first expense."
          }
          action={
            /* Stacked and full width on a phone; only the primary action is
               filled, so the order to do things in survives a narrow column. */
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button asChild>
                <Link href={`/groups/${groupId}/expenses/new`}>
                  <Plus aria-hidden="true" />
                  Add an expense
                </Link>
              </Button>
              {access.permissions.manageParticipants && (
                <Button asChild variant="outline">
                  <Link href={`/groups/${groupId}/members`}>
                    <Users aria-hidden="true" />
                    Add people
                  </Link>
                </Button>
              )}
              {access.permissions.importData && (
                <Button asChild variant="outline">
                  <Link href={`/groups/${groupId}/import`}>
                    <Upload aria-hidden="true" />
                    Import from Splitwise
                  </Link>
                </Button>
              )}
            </div>
          }
        />
      ) : (
        <>
          {/* Your position, first — it is what people open the app for. */}
          {myParticipantId && (
            <section aria-labelledby="your-position">
              <h2 id="your-position" className="sr-only">
                Your position
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {balances.currencies.map((entry) => {
                  const mine = entry.balances.find(
                    (balance) => balance.participantId === myParticipantId,
                  );
                  if (!mine) return null;
                  return (
                    <Card key={entry.currency}>
                      <CardContent className="space-y-1 p-4">
                        <p className="text-sm text-muted-foreground">
                          You, in {entry.currency}
                        </p>
                        {mine.amount === 0n ? (
                          <SettledBadge />
                        ) : (
                          <BalanceAmount
                            minorUnits={mine.amount.toString()}
                            currency={entry.currency}
                            size="large"
                          />
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          <section aria-labelledby="totals" className="space-y-3">
            <h2
              id="totals"
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground"
            >
              <Coins aria-hidden="true" className="size-4" />
              Total spending
            </h2>
            <div className="flex flex-wrap gap-2">
              {[...balances.totalSpend.entries()].map(([currency, total]) => (
                <span
                  key={currency}
                  className="inline-flex items-baseline gap-2 rounded-lg bg-muted px-3 py-2"
                >
                  <Amount
                    minorUnits={total.toString()}
                    currency={currency}
                    className="font-semibold"
                  />
                </span>
              ))}
            </div>
          </section>

          <section aria-labelledby="balances" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2
                id="balances"
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground"
              >
                <Scale aria-hidden="true" className="size-4" />
                Balances
              </h2>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/groups/${groupId}/balances`}>
                  Settle up
                  <ArrowRightLeft aria-hidden="true" />
                </Link>
              </Button>
            </div>

            {balances.currencies.map((entry) => {
              const owed = entry.balances.filter(
                (balance) => balance.amount > 0n,
              );
              const owing = entry.balances.filter(
                (balance) => balance.amount < 0n,
              );

              return (
                <Card key={entry.currency}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">
                      {entry.currency}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-0">
                    {owed.length === 0 && owing.length === 0 ? (
                      <SettledBadge />
                    ) : (
                      <>
                        {owing.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                              Owes money
                            </p>
                            <ul className="space-y-1.5">
                              {owing.map((balance) => (
                                <li
                                  key={balance.participantId}
                                  className="flex items-center justify-between gap-3 text-sm"
                                >
                                  <span className="truncate">
                                    {balances.participantNames.get(
                                      balance.participantId,
                                    )}
                                  </span>
                                  <BalanceAmount
                                    minorUnits={balance.amount.toString()}
                                    currency={entry.currency}
                                    showLabel={false}
                                    size="small"
                                  />
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {owed.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                              Should receive
                            </p>
                            <ul className="space-y-1.5">
                              {owed.map((balance) => (
                                <li
                                  key={balance.participantId}
                                  className="flex items-center justify-between gap-3 text-sm"
                                >
                                  <span className="truncate">
                                    {balances.participantNames.get(
                                      balance.participantId,
                                    )}
                                  </span>
                                  <BalanceAmount
                                    minorUnits={balance.amount.toString()}
                                    currency={entry.currency}
                                    showLabel={false}
                                    size="small"
                                  />
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </section>

          <section aria-labelledby="recent" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2
                id="recent"
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground"
              >
                <Receipt aria-hidden="true" className="size-4" />
                Recent expenses
              </h2>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/groups/${groupId}/expenses`}>See all</Link>
              </Button>
            </div>
            <ul className="divide-y rounded-lg border">
              {expenses.map((expense) => (
                <li key={expense.id}>
                  <Link
                    href={`/groups/${groupId}/expenses/${expense.id}`}
                    className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {expense.description}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {expense.expenseDate} ·{" "}
                        {expense.payers
                          .map((payer) => payer.displayName)
                          .join(", ")}
                      </span>
                    </span>
                    <Amount
                      minorUnits={expense.amount.toString()}
                      currency={expense.currency}
                      className="shrink-0 text-sm font-medium"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="activity" className="space-y-3">
            <h2
              id="activity"
              className="text-sm font-medium text-muted-foreground"
            >
              Recent activity
            </h2>
            <ActivityFeed entries={activity} />
          </section>
        </>
      )}
    </div>
  );
}
