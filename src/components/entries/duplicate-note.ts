import { foldText } from "@/modules/categorization";

/**
 * "Did I already log this?"
 *
 * The question people currently answer by scrolling the whole history, and
 * the reason they stop trusting the list. It is cheapest to answer at the
 * moment of entry, so when the amount and description look like something
 * from the last two days, the drawer says so in one quiet line.
 *
 * Three things this is not:
 *
 *  - **Not a warning.** Two coffee runs happen. Duplicates are legal, and the
 *    note never blocks, never pre-empts saving, and carries no coloured
 *    background.
 *  - **Not a list.** At most one match, the most recent. Three turns a
 *    reassurance into a chore.
 *  - **Not eager.** A false positive is expensive here — it makes a correct
 *    entry look wrong — so the rule starts strict and the caller debounces
 *    it, because a note that flashes while somebody types the third digit of
 *    an amount is noise about a number they have not finished writing.
 *
 * Expense-only, deliberately. Matching rent received against a grocery
 * expense is a false positive by construction, and the whole value of the
 * line is that it is rarely wrong.
 */

/** Two days. Longer, and a weekly shop starts matching last week's. */
export const DUPLICATE_WINDOW_HOURS = 48;

/** How far apart two amounts can be and still be the same purchase. */
export const DUPLICATE_AMOUNT_TOLERANCE = 0.02;

/** How much of the description has to agree, when the category does not. */
export const DUPLICATE_SIMILARITY = 0.6;

export interface RecentEntry {
  readonly id: string;
  readonly description: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly amountFormatted: string;
  readonly payerName: string;
  /** The category code, or "" — used as corroboration, never on its own. */
  readonly category: string;
  /** Hours since it was created. The caller measures; this only compares. */
  readonly hoursAgo: number;
}

/**
 * How alike two descriptions are, from 0 to 1.
 *
 * Token overlap rather than edit distance: "Coop Genève" and "Coop" are the
 * same shop, and an edit distance would call them far apart because one is
 * twice the length of the other. Folded for case and accents through the
 * classifier's own normaliser, so `Genève` and `geneve` are one word.
 */
export function descriptionSimilarity(a: string, b: string): number {
  const words = (value: string) =>
    new Set(
      foldText(value)
        .split(/\s+/)
        .filter((word) => word.length > 1),
    );

  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;

  // Against the shorter side, so a long description does not dilute a short
  // one it fully contains.
  return shared / Math.min(left.size, right.size);
}

/**
 * The recent entry this one looks like, or null.
 *
 * Amount is the gate: nothing matches without it, because two entries of
 * different amounts are two entries whatever they are called. Past that, one
 * of two corroborations is needed — the same category, or descriptions that
 * agree — so a second CHF 20.00 on the same day is not flagged merely for
 * being CHF 20.00.
 */
export function findDuplicate(input: {
  amountMinor: bigint;
  currency: string;
  description: string;
  /** The category in force, detected or chosen. "" when there is none. */
  category: string;
  recent: readonly RecentEntry[];
}): RecentEntry | null {
  const { amountMinor, currency, description, category, recent } = input;
  if (amountMinor <= 0n) return null;

  const candidates = recent.filter((entry) => {
    if (entry.currency !== currency) return false;
    if (entry.hoursAgo > DUPLICATE_WINDOW_HOURS || entry.hoursAgo < 0) {
      return false;
    }

    const other = BigInt(entry.amountMinor);
    if (other <= 0n) return false;
    const gap = other > amountMinor ? other - amountMinor : amountMinor - other;
    // Integer comparison rather than a float ratio: the amounts are cents, and
    // a percentage of a bigint is a rounding argument nobody needs to have.
    const tolerance =
      (other * BigInt(Math.round(DUPLICATE_AMOUNT_TOLERANCE * 10000))) / 10000n;
    if (gap > tolerance) return false;

    const sameCategory = category !== "" && entry.category === category;
    const alike =
      descriptionSimilarity(description, entry.description) >=
      DUPLICATE_SIMILARITY;
    return sameCategory || alike;
  });

  // The most recent, and only it.
  return (
    candidates.reduce<RecentEntry | null>(
      (best, entry) =>
        best === null || entry.hoursAgo < best.hoursAgo ? entry : best,
      null,
    ) ?? null
  );
}
