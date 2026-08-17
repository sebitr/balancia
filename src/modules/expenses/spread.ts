import type { CurrencyMode } from "@/modules/currencies/conversion";
import { moneyForGroup } from "@/modules/currencies/display";
import { isSpending, type EntryDirection } from "./direction";

/**
 * Where the money went, by category.
 *
 * Two rules decide what this counts, and both are borrowed rather than
 * reinvented so the spread can never disagree with the balances beside it:
 *
 *  - **Spending only.** `isSpending` is the gate, exactly as
 *    `totalSpendByCurrency` uses it. Income filed under `groceries` is not
 *    84.60 spent on groceries, it is 84.60 that came back, and settlements are
 *    not spending at all — they are a repayment, and they live in another
 *    table.
 *  - **The frozen rate, never a live one.** The amount is chosen the way
 *    `loadGroupBalances` chooses it: the converted figure in a converted group,
 *    the original everywhere else. History does not move when rates do.
 *
 * Totals are kept per currency and never summed across them. A group in
 * `separate` mode can hold several at once, and adding them would require
 * inventing an exchange rate — the same reason the stat strip stacks its
 * figures instead of totalling them.
 */

export interface SpreadEntry {
  readonly direction: EntryDirection;
  /** As stored: a canonical code, imported free text, or nothing. */
  readonly category: string | null;
  readonly amount: bigint;
  readonly currency: string;
  readonly convertedAmount: bigint | null;
  readonly convertedCurrency: string | null;
}

export interface CategoryTotal {
  /** The stored category string; null when nobody chose one. */
  readonly category: string | null;
  readonly total: bigint;
}

/** One currency's spending, broken down by category, biggest first. */
export interface CategorySpread {
  readonly currency: string;
  readonly total: bigint;
  readonly categories: readonly CategoryTotal[];
}

/**
 * The filter key a category travels under, in the URL and as a React key.
 *
 * Uncategorised spending is the empty string, which no stored category can
 * collide with: the expense service writes `input.category || null`, so an
 * empty string never reaches the column.
 */
export const UNCATEGORISED = "";

export function categoryKeyOf(category: string | null): string {
  return category ?? UNCATEGORISED;
}

/**
 * Spending per category, per currency, biggest currency first.
 *
 * A canonical code and a free-text value imported under a similar name are
 * deliberately separate buckets. Folding an unrecognised string into `other`
 * would put it beside expenses whose owner actually chose "Other", and would
 * hide the fact that the string never reaches a categorization rule.
 */
export function categoryTotals(
  entries: readonly SpreadEntry[],
  group: { mode: CurrencyMode; baseCurrency: string | null },
): CategorySpread[] {
  const byCurrency = new Map<string, Map<string | null, bigint>>();

  for (const entry of entries) {
    if (!isSpending(entry.direction)) continue;

    const { amount, currency } = moneyForGroup(entry, group);

    const bucket = byCurrency.get(currency) ?? new Map<string | null, bigint>();
    bucket.set(entry.category, (bucket.get(entry.category) ?? 0n) + amount);
    byCurrency.set(currency, bucket);
  }

  const spreads: CategorySpread[] = [];
  for (const [currency, bucket] of byCurrency) {
    const categories = [...bucket]
      .map(([category, total]) => ({ category, total }))
      .sort(byTotalThenKey);
    spreads.push({
      currency,
      total: categories.reduce((sum, entry) => sum + entry.total, 0n),
      categories,
    });
  }

  // Currencies ranked the same way categories are, so a caller taking the
  // first takes the one the group spends most in.
  return spreads.sort((a, b) => {
    if (a.total !== b.total) return a.total > b.total ? -1 : 1;
    return a.currency < b.currency ? -1 : 1;
  });
}

/** Biggest first, then by key — ties must not reorder between renders. */
function byTotalThenKey(a: CategoryTotal, b: CategoryTotal): number {
  if (a.total !== b.total) return a.total > b.total ? -1 : 1;
  return categoryKeyOf(a.category) < categoryKeyOf(b.category) ? -1 : 1;
}

/**
 * Whether anybody has filed any of this spending under a category.
 *
 * A group where nobody has still produces a spread: everything lands in the
 * uncategorised bucket, which then holds the whole total. That is a breakdown
 * with nothing broken down, and a caller drawing one — the spine — has nothing
 * to draw and should not.
 */
export function isCategorised(spread: CategorySpread): boolean {
  return spread.categories.some((entry) => entry.category !== null);
}

/**
 * How many categories get a colour of their own.
 *
 * Five, because five is how many `--chart-*` tokens the design system has.
 * Categorical colour is a vocabulary, not a scale — inventing a sixth would
 * either repeat one of the five or land outside the palette.
 */
export const RANKED_BANDS = 5;

export interface SpreadBand {
  /** Stable identity for a React key; the lead category's filter key. */
  readonly key: string;
  /** Every category the band covers — more than one only in the remainder. */
  readonly categories: readonly string[];
  readonly total: bigint;
  /**
   * Share of the currency's spend in **tenths of a percent** (786 = 78.6%).
   *
   * An integer, because the ratio is computed from bigints and never routed
   * through a float. The band's height is this number and so is the figure
   * printed on it, so the two cannot drift apart.
   */
  readonly share: number;
  /** 1–5 for a band with a colour of its own; null for the grouped remainder. */
  readonly rank: number | null;
}

/**
 * The categories ranked into bands: the top five, then everything else as one.
 *
 * The remainder exists because the palette runs out, not because those
 * categories are unimportant — it keeps its combined total and its share, and
 * the caller labels it after the largest category inside it.
 */
export function spreadBands(spread: CategorySpread): SpreadBand[] {
  /**
   * Rounded half-up rather than truncated: a band holding 5.767% of the spend
   * prints "5.8%", and truncation would print "5.7%" — a tenth the reader
   * could check against the amounts and find wrong. Doubling both sides is
   * what keeps the halving itself exact in integer arithmetic.
   */
  const shareOf = (total: bigint): number =>
    spread.total === 0n
      ? 0
      : Number((total * 2000n + spread.total) / (spread.total * 2n));

  const ranked = spread.categories
    .slice(0, RANKED_BANDS)
    .map((entry, index): SpreadBand => ({
      key: categoryKeyOf(entry.category),
      categories: [categoryKeyOf(entry.category)],
      total: entry.total,
      share: shareOf(entry.total),
      rank: index + 1,
    }));

  const rest = spread.categories.slice(RANKED_BANDS);
  if (rest.length === 0) return ranked;

  const total = rest.reduce((sum, entry) => sum + entry.total, 0n);
  return [
    ...ranked,
    {
      key: categoryKeyOf(rest[0].category),
      categories: rest.map((entry) => categoryKeyOf(entry.category)),
      total,
      share: shareOf(total),
      rank: null,
    },
  ];
}
