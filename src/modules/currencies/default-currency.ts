/**
 * Which currency a form opens on, when nobody has said.
 *
 * Three screens ask this question — the entry drawer, the recurring-entry
 * form, and the sheet that creates a group — and until this module they each
 * answered it differently. The entry drawer read
 * `group.baseCurrency ?? "EUR"`; the create-group sheet read
 * `preferredCurrency ?? "CHF"`. So the same account, with no stated
 * preference, got CHF making a group and EUR making an expense, and neither
 * path ever looked at the currency the group was actually being kept in.
 *
 * That last omission is the one that showed. A Geneva flatshare in
 * `currencyMode: "separate"` has no base currency by definition — the column
 * is null, so the literal always won — and its five expenses and every one of
 * its balances were in CHF. The drawer opened on EUR anyway, under a hero
 * reading `-CHF 960.84`. Getting it wrong costs a tap and a scroll through the
 * currency list; not noticing costs a wrong entry and a recalculated balance
 * for everyone in the group.
 *
 * The order below is strongest signal first. Each step is something somebody
 * actually said, and only the last is a guess.
 */

/**
 * The guess, once every signal has come back empty.
 *
 * Only reachable for a brand-new group, with no base currency, no entries yet,
 * belonging to an account that has never set a preferred currency — which is
 * to say, on the first expense of the first group of a new account and
 * essentially nowhere else. The two literals this replaces disagreed; one of
 * them had to win, and the wider audience is the euro one.
 */
export const FALLBACK_CURRENCY = "EUR";

/** How much a group leans on one currency. Any non-negative measure will do. */
export interface CurrencyUse {
  readonly currency: string;
  readonly weight: bigint;
}

/**
 * The currency a group leans on hardest, or null if it has no entries at all.
 *
 * Ties keep the first, which matters more than it looks: a fully settled group
 * weighs every currency at zero, and "the first currency this group has ever
 * used" is still a far better answer than a constant from another continent.
 */
export function mostUsedCurrency(uses: readonly CurrencyUse[]): string | null {
  let best: CurrencyUse | null = null;
  for (const use of uses) {
    if (best === null || use.weight > best.weight) best = use;
  }
  return best?.currency ?? null;
}

export interface CurrencySignals {
  /** The entry being edited. Its own currency is never overridden. */
  readonly editing?: string | null;
  /** The group's declared base currency, where it has named one. */
  readonly base?: string | null;
  /** What this group has actually been spending in. */
  readonly used?: readonly CurrencyUse[];
  /** The account's stated preference, for a group too new to have a habit. */
  readonly preferred?: string | null;
}

export function defaultCurrency(signals: CurrencySignals): string {
  return (
    signals.editing ??
    signals.base ??
    mostUsedCurrency(signals.used ?? []) ??
    signals.preferred ??
    FALLBACK_CURRENCY
  );
}
