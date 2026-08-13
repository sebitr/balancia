import "server-only";
import type { Database } from "@/lib/db/client";
import {
  absMoney,
  addMoney,
  compareMoney,
  convertMoney,
  isNegative,
  isPositive,
  money,
  subtractMoney,
  zero,
  type Money,
} from "@/modules/currencies/money";
import { isSupportedCurrency } from "@/modules/currencies/iso-4217";
import { todayIso } from "@/modules/currencies/provider";
import { lookupRate } from "@/modules/currencies/rates";
import { listGroupsForUser, type GroupSummary } from "@/modules/groups/service";
import { loadGroupBalances } from "./service";

/**
 * The home screen's read model: where the user stands across every group.
 *
 * Per-group arithmetic is not repeated here — `loadGroupBalances` remains the
 * one place balances are derived, and this module only picks the user's own row
 * out of each group's result, converts it, and ranks the groups.
 *
 * Conversion is best-effort by construction. An instance with no rates provider
 * configured, or a currency the provider does not quote, leaves `net` null: the
 * screen then shows each group in its own currency and says so, because a total
 * that silently drops a currency would be a wrong number rather than a missing
 * one.
 */

/** The user's standing in one group. */
export interface GroupPosition {
  readonly group: GroupSummary;
  /** Non-zero balances of the user, in the currencies the group balances in. */
  readonly amounts: readonly Money[];
  /** `amounts` summed into the display currency; null if a rate was missing. */
  readonly net: Money | null;
}

export type PositionDirection = "owes" | "owed" | "settled";

export interface HomeBuckets {
  readonly youOwe: readonly GroupPosition[];
  readonly youAreOwed: readonly GroupPosition[];
  readonly settled: readonly GroupPosition[];
  readonly archived: readonly GroupPosition[];
}

export interface NetPosition {
  readonly owedToYou: Money;
  readonly youOwe: Money;
  /** `owedToYou - youOwe`; positive means the user is owed overall. */
  readonly net: Money;
  readonly owedGroupCount: number;
  readonly owingGroupCount: number;
}

export interface HomeOverview {
  /** What the header totals in. Null when there is nothing to total. */
  readonly displayCurrency: string | null;
  /** Null when any position could not be converted — never a partial sum. */
  readonly netPosition: NetPosition | null;
  /** Always populated; what the header shows when `netPosition` is null. */
  readonly currencyTotals: readonly CurrencyTotal[];
  /** Oldest fixing date behind the conversions, `YYYY-MM-DD`. */
  readonly ratesAsOf: string | null;
  /** Whether any amount actually had to be converted to reach the total. */
  readonly converted: boolean;
  readonly buckets: HomeBuckets;
  readonly groupCount: number;
}

/**
 * Which section a group belongs under.
 *
 * A group holding both a debt and a credit in different currencies has no
 * single sign of its own; it is ranked by its converted net where one exists,
 * and otherwise counted as owing — of the two possible mistakes, prompting
 * someone to look at a group is the harmless one.
 */
export function directionOf(position: GroupPosition): PositionDirection {
  if (position.amounts.length === 0) return "settled";
  if (position.net) {
    if (isPositive(position.net)) return "owed";
    if (isNegative(position.net)) return "owes";
    return "settled";
  }
  const positives = position.amounts.filter(isPositive).length;
  const negatives = position.amounts.filter(isNegative).length;
  if (negatives > 0) return "owes";
  return positives > 0 ? "owed" : "settled";
}

/** Largest first where amounts are comparable, most recently active otherwise. */
function byUrgency(a: GroupPosition, b: GroupPosition): number {
  if (a.net && b.net && a.net.currency === b.net.currency) {
    const size = compareMoney(absMoney(b.net), absMoney(a.net));
    if (size !== 0) return size;
  }
  return byRecency(a, b);
}

function byRecency(a: GroupPosition, b: GroupPosition): number {
  return b.group.lastActivityAt.getTime() - a.group.lastActivityAt.getTime();
}

/**
 * Ranks groups by whether they need the user: what they owe, what they are
 * owed, what is settled, then what they have archived.
 */
export function bucketPositions(
  positions: readonly GroupPosition[],
): HomeBuckets {
  const active = positions.filter(
    (position) => position.group.archivedAt === null,
  );
  const byDirection = (direction: PositionDirection) =>
    active.filter((position) => directionOf(position) === direction);

  return {
    youOwe: byDirection("owes").sort(byUrgency),
    youAreOwed: byDirection("owed").sort(byUrgency),
    settled: byDirection("settled").sort(byRecency),
    archived: positions
      .filter((position) => position.group.archivedAt !== null)
      .sort(byRecency),
  };
}

/**
 * The two totals the header decomposes into, and their difference.
 *
 * Returns null if a single position is missing its conversion: the whole point
 * of the figure is that it covers everything.
 */
export function netPositionOf(
  positions: readonly GroupPosition[],
  currency: string,
): NetPosition | null {
  let owedToYou = zero(currency);
  let youOwe = zero(currency);
  let owedGroupCount = 0;
  let owingGroupCount = 0;

  for (const position of positions) {
    // An archived group is out of sight on this screen; leaving it in the
    // total would make the figure impossible to reconcile with the list.
    if (position.group.archivedAt !== null) continue;
    if (position.amounts.length === 0) continue;
    if (!position.net) return null;

    if (isPositive(position.net)) {
      owedToYou = addMoney(owedToYou, position.net);
      owedGroupCount += 1;
    } else if (isNegative(position.net)) {
      youOwe = addMoney(youOwe, absMoney(position.net));
      owingGroupCount += 1;
    }
  }

  return {
    owedToYou,
    youOwe,
    net: subtractMoney(owedToYou, youOwe),
    owedGroupCount,
    owingGroupCount,
  };
}

export interface CurrencyTotal {
  readonly currency: string;
  readonly owedToYou: Money;
  readonly youOwe: Money;
}

/**
 * The same two totals, kept per currency and never added together.
 *
 * This is what the header falls back to when there is no rate to convert with:
 * several honest figures instead of one invented one.
 */
export function perCurrencyTotals(
  positions: readonly GroupPosition[],
): CurrencyTotal[] {
  const owed = new Map<string, Money>();
  const owing = new Map<string, Money>();

  for (const position of positions) {
    if (position.group.archivedAt !== null) continue;
    for (const amount of position.amounts) {
      const bucket = isPositive(amount) ? owed : owing;
      const running = bucket.get(amount.currency) ?? zero(amount.currency);
      bucket.set(amount.currency, addMoney(running, absMoney(amount)));
    }
  }

  const currencies = [...new Set([...owed.keys(), ...owing.keys()])].sort();
  return currencies.map((currency) => ({
    currency,
    owedToYou: owed.get(currency) ?? zero(currency),
    youOwe: owing.get(currency) ?? zero(currency),
  }));
}

/**
 * What to total in: the user's stated choice, or the currency their own groups
 * balance in most often. Ties go to the most recently active group, since
 * `positions` arrives in that order.
 */
export function resolveDisplayCurrency(
  preferred: string | null,
  positions: readonly GroupPosition[],
): string | null {
  if (preferred && isSupportedCurrency(preferred)) return preferred;

  const counts = new Map<string, number>();
  for (const position of positions) {
    if (position.group.archivedAt !== null) continue;
    for (const amount of position.amounts) {
      counts.set(amount.currency, (counts.get(amount.currency) ?? 0) + 1);
    }
  }

  let winner: string | null = null;
  let best = 0;
  for (const [currency, count] of counts) {
    if (count > best) {
      winner = currency;
      best = count;
    }
  }
  return winner;
}

/** Memoised per request: several groups usually share a currency pair. */
type RateCache = Map<string, { rate: string; quotedOn: string } | null>;

async function rateFor(
  from: string,
  to: string,
  on: string,
  cache: RateCache,
): Promise<{ rate: string; quotedOn: string } | null> {
  const key = `${from}>${to}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let quote: { rate: string; quotedOn: string } | null = null;
  try {
    const looked = await lookupRate({ from, to, on });
    quote = looked ? { rate: looked.rate, quotedOn: looked.quotedOn } : null;
  } catch {
    // An unknown currency or a misconfigured provider is a missing rate, not
    // a broken home screen.
    quote = null;
  }
  cache.set(key, quote);
  return quote;
}

/** The user's own balances in one group, zero-filtered. */
function ownAmounts(
  group: GroupSummary,
  currencies: Awaited<ReturnType<typeof loadGroupBalances>>["currencies"],
): Money[] {
  const amounts: Money[] = [];
  for (const entry of currencies) {
    const mine = entry.balances.find(
      (balance) => balance.participantId === group.participantId,
    );
    if (mine && mine.amount !== 0n) {
      amounts.push(money(mine.amount, entry.currency));
    }
  }
  return amounts;
}

export async function loadHomeOverview(
  userId: string,
  options: {
    preferredCurrency?: string | null;
    now?: Date;
    db?: Database;
  } = {},
): Promise<HomeOverview> {
  const now = options.now ?? new Date();
  const groups = await listGroupsForUser(userId, { db: options.db });

  const unconverted: GroupPosition[] = await Promise.all(
    groups.map(async (group) => {
      const balances = await loadGroupBalances(
        { groupId: group.id, group },
        { db: options.db },
      );
      return {
        group,
        amounts: ownAmounts(group, balances.currencies),
        net: null,
      };
    }),
  );

  const displayCurrency = resolveDisplayCurrency(
    options.preferredCurrency ?? null,
    unconverted,
  );

  if (!displayCurrency) {
    return {
      displayCurrency: null,
      netPosition: null,
      currencyTotals: perCurrencyTotals(unconverted),
      ratesAsOf: null,
      converted: false,
      buckets: bucketPositions(unconverted),
      groupCount: groups.length,
    };
  }

  const cache: RateCache = new Map();
  const on = todayIso(now);
  const quotedOnDates: string[] = [];

  const positions: GroupPosition[] = [];
  for (const position of unconverted) {
    let net: Money | null = zero(displayCurrency);
    for (const amount of position.amounts) {
      if (amount.currency === displayCurrency) {
        net = addMoney(net, amount);
        continue;
      }
      const quote = await rateFor(amount.currency, displayCurrency, on, cache);
      if (!quote) {
        net = null;
        break;
      }
      quotedOnDates.push(quote.quotedOn);
      net = addMoney(net, convertMoney(amount, displayCurrency, quote.rate));
    }
    positions.push({ ...position, net });
  }

  return {
    displayCurrency,
    netPosition: netPositionOf(positions, displayCurrency),
    currencyTotals: perCurrencyTotals(positions),
    ratesAsOf:
      quotedOnDates.length > 0
        ? quotedOnDates.reduce((a, b) => (a < b ? a : b))
        : null,
    converted: quotedOnDates.length > 0,
    buckets: bucketPositions(positions),
    groupCount: groups.length,
  };
}
