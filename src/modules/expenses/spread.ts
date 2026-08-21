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
  /**
   * The stored subcategory, carried but not yet totalled by.
   *
   * The primary spread stays at the top level — introducing subcategories must
   * not silently split `Transport €540` into eleven slices nobody asked for.
   * It is here so a drill-down can be built on `subcategoryTotals` without
   * another pass over the table.
   */
  readonly subcategory: string | null;
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
 * How many distinct category colours the design system provides.
 *
 * Five, because five is how many `--chart-*` tokens the design system has.
 * A caller showing more than five categories cycles through that vocabulary;
 * the category label and glyph remain the primary identifiers.
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
 * The categories ranked into bands: the requested number, then everything
 * else as one. Five named bands is the default because it uses every category
 * colour once; a height-aware caller can request more or fewer.
 *
 * The remainder exists when the caller's available slots run out, not because
 * those categories are unimportant — it keeps its combined total and its
 * share, and the caller labels it after the largest category inside it.
 */
export function spreadBands(
  spread: CategorySpread,
  rankedBandCount = RANKED_BANDS,
): SpreadBand[] {
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

  const rankedCount = Math.max(1, Math.floor(rankedBandCount));
  const ranked = spread.categories
    .slice(0, rankedCount)
    .map((entry, index): SpreadBand => ({
      key: categoryKeyOf(entry.category),
      categories: [categoryKeyOf(entry.category)],
      total: entry.total,
      share: shareOf(entry.total),
      rank: (index % RANKED_BANDS) + 1,
    }));

  const rest = spread.categories.slice(rankedCount);
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

/**
 * One category broken down by subcategory, in one currency.
 *
 * The drill-down half of the spread, and deliberately a separate function
 * rather than a field on `CategorySpread`: the charts that exist today ask
 * "where did the money go" and are answered at the top level, and computing a
 * breakdown they never render would be work done for nobody. A view that wants
 * `Transport → Flights €310, Fuel €120` calls this with the category it opened.
 *
 * `null` is a real bucket, not a gap. Spending filed as `transport` with
 * nothing under it is most transport spending, and hiding it would make the
 * parts add up to less than the whole.
 *
 * Returns the same shape as `categoryTotals`, with the subcategory in the
 * `category` field — it is the category *of this breakdown*, and reusing the
 * shape is what keeps the currency and direction rules identical to the
 * spread it drills into.
 */
export function subcategoryTotals(
  entries: readonly SpreadEntry[],
  category: string | null,
  group: { mode: CurrencyMode; baseCurrency: string | null },
): CategorySpread[] {
  return categoryTotals(
    entries
      .filter((entry) => entry.category === category)
      // The breakdown is over the child, so the child stands in as the key and
      // `categoryTotals` does the currency and direction work exactly once.
      .map((entry) => ({ ...entry, category: entry.subcategory })),
    group,
  );
}
