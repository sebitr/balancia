import type { CurrencyMode } from "./conversion";

export interface StoredMoney {
  readonly amount: bigint;
  readonly currency: string;
  readonly convertedAmount: bigint | null;
  readonly convertedCurrency: string | null;
}

/**
 * Selects the amount a group has chosen to reason in.
 *
 * Same-currency entries do not persist a redundant conversion, so converted
 * groups deliberately fall back to the original amount and the group's base
 * currency. Foreign-currency entries use their frozen conversion, keeping the
 * list, category spread, and balances on the same historical rate.
 */
export function moneyForGroup(
  entry: StoredMoney,
  group: { readonly mode: CurrencyMode; readonly baseCurrency: string | null },
): { amount: bigint; currency: string } {
  if (group.mode === "separate") {
    return { amount: entry.amount, currency: entry.currency };
  }

  return {
    amount: entry.convertedAmount ?? entry.amount,
    currency: entry.convertedCurrency ?? group.baseCurrency ?? entry.currency,
  };
}

/** The allocation paired with `moneyForGroup`, in the same display mode. */
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
