import type { RemindDebt } from "./types";

/**
 * Adding up debts without ever adding up currencies.
 *
 * A separate-currency group produces one set of balances per currency, so the
 * same two people can owe each other in euros *and* in yen. Those two figures
 * have no sum: merging them would need a rate nobody chose, and would put a
 * number on screen that no debt actually matches. Everything here therefore
 * returns a list — one entry per currency — and the screens show it as one.
 */

/**
 * Largest first, then by code.
 *
 * Across currencies this compares minor units, which is not a meaningful
 * ordering — 1400 yen is not "more" than 1200 euros. It is deliberately
 * arbitrary rather than invented: an exchange rate would be a claim, and this
 * is only a stable order. Within one currency it is exactly "largest first",
 * which is the case that reads as ranked.
 */
export function compareDebts(a: RemindDebt, b: RemindDebt): number {
  const left = BigInt(a.amount);
  const right = BigInt(b.amount);
  if (left !== right) return right > left ? 1 : -1;
  return a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0;
}

/** Totals a set of debts into one entry per currency, largest first. */
export function sumByCurrency(debts: readonly RemindDebt[]): RemindDebt[] {
  const totals = new Map<string, bigint>();
  for (const debt of debts) {
    totals.set(
      debt.currency,
      (totals.get(debt.currency) ?? 0n) + BigInt(debt.amount),
    );
  }
  return [...totals]
    .map(([currency, amount]) => ({ amount: amount.toString(), currency }))
    .sort(compareDebts);
}
