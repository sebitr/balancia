import {
  contributionsOf,
  type BalanceInputExpense,
} from "@/modules/balances/engine";
import { isSpending } from "@/modules/expenses/direction";

/**
 * What everyone paid and what their share came to, for the People table.
 *
 * In one currency, because a column holds one: the figures in it are summed
 * by nobody, but a column of "€586.60" over "CHF 96.00" would invite exactly
 * that. The others are named under the table and are on each person's page,
 * where the statistics repeat per currency.
 *
 * Which currency leads is the one the group spends in most often — counted in
 * entries, not in minor units, because a single yen row imported without a
 * rate outweighs years of euros by the second measure. A converted group's
 * base currency leads whatever the count, as it heads the statistics: it is
 * the currency the group keeps its books in.
 *
 * Read off the rows the balances were computed from (`spendingFacts`), so the
 * columns cost no query and cannot disagree with the position beside them.
 * Spending only, as `contributionsOf` is: neither word survives income.
 */
export interface PeopleLedger {
  /** The currency the Paid and Share columns are in. */
  readonly currency: string;
  /** Every other currency the group spends in, for the line under the table. */
  readonly others: readonly string[];
  /** Per participant, in minor units. Absent means nothing paid, no share. */
  readonly figures: Readonly<
    Record<string, { readonly paid: string; readonly share: string }>
  >;
}

export function peopleLedger(
  facts: readonly BalanceInputExpense[],
  participantIds: readonly string[],
  /** A converted group's base currency, which leads when it is spent in. */
  lead: string | null,
): PeopleLedger | null {
  const entries = new Map<string, number>();
  for (const fact of facts) {
    if (!isSpending(fact.direction)) continue;
    entries.set(fact.currency, (entries.get(fact.currency) ?? 0) + 1);
  }
  if (entries.size === 0) return null;

  const ordered = [...entries.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([currency]) => currency);
  const currency =
    lead !== null && ordered.includes(lead) ? lead : (ordered[0] ?? "");

  const figures: Record<string, { paid: string; share: string }> = {};
  for (const id of participantIds) {
    const totals = contributionsOf(facts, id).get(currency);
    if (!totals) continue;
    figures[id] = {
      paid: totals.paid.toString(),
      share: totals.share.toString(),
    };
  }

  return {
    currency,
    others: ordered.filter((other) => other !== currency),
    figures,
  };
}
