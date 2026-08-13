import { getTranslations } from "next-intl/server";
import { ArrowRight, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Amount, BalanceAmount, SettledBadge } from "@/components/money/amount";
import { SettleUpDialog } from "@/components/settlements/settle-up-dialog";
import { requireGroupAccess } from "@/lib/actions";
import { loadGroupBalances } from "@/modules/balances/service";
import { listParticipants } from "@/modules/groups/service";

/**
 * Balances and suggested repayments.
 *
 * Raw balances and the simplified repayment plan are shown separately and
 * labelled as such: the suggestions are a convenience, not a rewrite of what
 * was recorded.
 */
export default async function BalancesPage({
  params,
}: PageProps<"/groups/[groupId]/balances">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  const [balances, participants] = await Promise.all([
    loadGroupBalances(access),
    listParticipants(access.groupId),
  ]);

  const everythingSettled = balances.currencies.every((entry) =>
    entry.balances.every((balance) => balance.amount === 0n),
  );

  const t = await getTranslations("balancesPage");

  // Shared by the header dialog and every per-suggestion one.
  const participantOptions = participants.map((participant) => ({
    id: participant.id,
    displayName: participant.displayName,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <SettleUpDialog
          groupId={access.groupId}
          participants={participantOptions}
          currencyMode={access.group.currencyMode}
          baseCurrency={access.group.baseCurrency}
          defaultCurrency={access.group.baseCurrency ?? "EUR"}
        />
      </div>

      {balances.currencies.length === 0 || everythingSettled ? (
        <EmptyState
          icon={Scale}
          title={t("allSettledTitle")}
          description={t("allSettledDescription")}
        />
      ) : (
        balances.currencies.map((entry) => {
          const suggestions =
            balances.suggestionsByCurrency.get(entry.currency) ?? [];
          const nonZero = entry.balances.filter(
            (balance) => balance.amount !== 0n,
          );

          return (
            <section key={entry.currency} className="space-y-3">
              <h2 className="font-heading text-lg font-medium">
                {entry.currency}
              </h2>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">
                    {t("whoOwesWhat")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {nonZero.length === 0 ? (
                    <SettledBadge />
                  ) : (
                    <ul className="divide-y">
                      {entry.balances.map((balance) => (
                        <li
                          key={balance.participantId}
                          className="flex items-center justify-between gap-3 py-2.5 text-sm"
                        >
                          <span className="truncate">
                            {balances.participantNames.get(
                              balance.participantId,
                            )}
                          </span>
                          {balance.amount === 0n ? (
                            <SettledBadge />
                          ) : (
                            <BalanceAmount
                              minorUnits={balance.amount.toString()}
                              currency={entry.currency}
                              size="small"
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {suggestions.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">
                      {t("suggestedRepayments")}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {t("suggestedNote")}
                    </p>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="divide-y">
                      {suggestions.map((suggestion, index) => (
                        <li
                          key={`${suggestion.fromParticipantId}-${suggestion.toParticipantId}-${index}`}
                          // Names on their own line at phone width so neither
                          // one is truncated to make room for the button.
                          className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="flex min-w-0 items-center gap-2 text-sm">
                            <span className="truncate">
                              {balances.participantNames.get(
                                suggestion.fromParticipantId,
                              )}
                            </span>
                            <ArrowRight
                              aria-hidden="true"
                              className="size-4 shrink-0 text-muted-foreground"
                            />
                            <span className="truncate">
                              {balances.participantNames.get(
                                suggestion.toParticipantId,
                              )}
                            </span>
                          </span>
                          <span className="flex items-center justify-between gap-3 sm:justify-end">
                            <Amount
                              minorUnits={suggestion.amount.toString()}
                              currency={suggestion.currency}
                              className="text-sm font-medium"
                            />
                            {/* A fresh dialog per suggestion: mounting rather
                                than syncing props means a half-typed amount is
                                never overwritten. */}
                            <SettleUpDialog
                              key={`${suggestion.fromParticipantId}-${suggestion.toParticipantId}-${suggestion.amount}`}
                              groupId={access.groupId}
                              participants={participantOptions}
                              currencyMode={access.group.currencyMode}
                              baseCurrency={access.group.baseCurrency}
                              defaultCurrency={
                                access.group.baseCurrency ?? "EUR"
                              }
                              initialFromId={suggestion.fromParticipantId}
                              initialToId={suggestion.toParticipantId}
                              initialAmountMinor={suggestion.amount.toString()}
                              initialCurrency={suggestion.currency}
                              trigger={
                                <Button
                                  size="sm"
                                  variant="outline"
                                  // 44px tap target on a phone, compact above.
                                  className="h-11 px-4 sm:h-7 sm:px-2.5"
                                >
                                  Record
                                </Button>
                              }
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
