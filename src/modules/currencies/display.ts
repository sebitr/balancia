import type { CurrencyMode } from "./conversion";

export interface StoredMoney {
  readonly amount: bigint;
  readonly currency: string;
  readonly convertedAmount: bigint | null;
  readonly convertedCurrency: string | null;
}

/**
 * The currency a group keeps an entry's balance in.
 *
 * A separate group keeps every entry in the currency it was written in. A
 * converted group keeps it in the base currency whenever it can say what the
 * entry is worth there: when it was written in the base, or when it carries a
 * conversion frozen at the time it was recorded.
 *
 * A foreign entry with neither stays in its own currency. That is an imported
 * Splitwise row or a restored backup, both of which arrive without a rate on
 * purpose — inventing a historical one would be worse — and until somebody
 * re-enters it with a rate there is no base figure to count. Reading its
 * amount as one would put 30 000 yen on the books as 30 000 euros.
 *
 * The conversion columns are written together or not at all, and a check
 * constraint holds every row to that, so `convertedCurrency` alone answers
 * whether there is a conversion.
 */
export function ledgerCurrencyOf(
  entry: {
    readonly currency: string;
    readonly convertedCurrency: string | null;
  },
  mode: CurrencyMode,
): string {
  return mode === "converted" && entry.convertedCurrency !== null
    ? entry.convertedCurrency
    : entry.currency;
}

/**
 * Selects the amount a group has chosen to reason in.
 *
 * Foreign-currency entries in a converted group use their frozen conversion,
 * keeping the list, category spread, and balances on the same historical rate.
 * Everything else keeps the money it was written in: a same-currency entry
 * does not persist a redundant conversion, so its own amount already is the
 * base figure, and a foreign one that arrived with no rate stays in its own
 * currency for the reason `ledgerCurrencyOf` gives.
 */
export function moneyForGroup(
  entry: StoredMoney,
  group: { readonly mode: CurrencyMode; readonly baseCurrency: string | null },
): { amount: bigint; currency: string } {
  if (
    group.mode === "converted" &&
    entry.convertedAmount !== null &&
    entry.convertedCurrency !== null
  ) {
    return { amount: entry.convertedAmount, currency: entry.convertedCurrency };
  }

  return { amount: entry.amount, currency: entry.currency };
}

/**
 * The allocation paired with `moneyForGroup`, in the same display mode.
 *
 * An allocation carries a converted amount exactly when its entry does, so an
 * entry kept in its own currency hands back its own-currency allocations here
 * too, and the two never disagree about which money they are in.
 */
export function allocationForGroup(
  allocation: {
    readonly amount: bigint;
    readonly convertedAmount: bigint | null;
  },
  mode: CurrencyMode,
): bigint {
  return mode === "converted"
    ? (allocation.convertedAmount ?? allocation.amount)
    : allocation.amount;
}
