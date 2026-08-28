import { DateTime } from "luxon";
import { isSpending } from "@/modules/expenses/direction";
import { normalizeLegacyPair } from "@/modules/categorization/taxonomy";
import {
  STATS_RANGES,
  bucketIndexOf,
  bucketsFor,
  monthsBetween,
  percentOf,
  totalOf,
  windowOf,
  type Granularity,
  type StatsEntryFact,
  type StatsRange,
  type StatsSettlementFact,
} from "./member-stats";

/**
 * A whole group, read as statistics.
 *
 * The member screen answers "what did one person put in"; this answers the
 * three questions a group has about itself — what it spent, who carried it,
 * and where the money went — over a window the reader chooses.
 *
 * The rules from `member-stats.ts` hold here unchanged, and two of them are
 * the reason this file exists rather than a `SUM()` in a query:
 *
 * **Currencies stack, they never sum.** Every figure below is per currency,
 * and a group kept in euros and francs shows two of each. Adding them would
 * invent a rate nobody agreed to.
 *
 * **Settlements are not spending.** A repayment moves a balance between two
 * members and buys nothing, so it is excluded from the total, the chart, the
 * categories and the weekday counts. It appears in one place only — the flows
 * card — where the volume of repayments is the question being asked.
 *
 * A third rule is this file's own: **money in is not money out.** An entry
 * recorded as income (`direction: "in"`) is revenue, reported beside spending
 * and never inside it. Netting the two is a choice the reader makes with the
 * toggle, and it reaches exactly two figures — the total and the per-person
 * average — because a category chart drawn from netted amounts would show a
 * refund as a category that was never spent in.
 *
 * Everything here is pure: the loader in `group-stats-service.ts` reads the
 * rows, this decides what they mean.
 */

/** An entry, with the second level of the vocabulary the categories card reads. */
export interface GroupStatsEntryFact extends StatsEntryFact {
  readonly subcategory: string | null;
  /** Everyone on the entry, so a payer can be named in the records. */
  readonly payers: readonly { participantId: string; amount: bigint }[];
}

/** One bar of the spend series. */
export interface SpendBucket {
  /** First day the bucket covers, as `YYYY-MM-DD`. The screen labels it. */
  readonly start: string;
  readonly amount: bigint;
  readonly entryCount: number;
}

/** What came in, what went out, and what merely moved between members. */
export interface GroupFlows {
  readonly spent: bigint;
  readonly spentCount: number;
  readonly revenue: bigint;
  readonly revenueCount: number;
  readonly settled: bigint;
  readonly settledCount: number;
}

/** One member's four figures, all in one currency. */
export interface MemberStanding {
  readonly participantId: string;
  readonly name: string;
  readonly isSelf: boolean;
  /** What they put on their own card over the window. */
  readonly paid: bigint;
  /** What the split ratios recorded on those entries made theirs. */
  readonly share: bigint;
  /** Paid − share. A payment habit, not a balance. */
  readonly net: bigint;
  /** Their balance today, after every repayment. Sums to zero across the group. */
  readonly open: bigint;
}

/** A subcategory's slice of its parent. */
export interface SubcategorySlice {
  readonly subcategory: string;
  readonly amount: bigint;
  /** Percent of the parent category, one decimal. */
  readonly percent: number;
}

/**
 * One category's slice of the window's spend.
 *
 * `children` plus `remainder` equal `amount` exactly — the card is an
 * accordion, and a total that did not reconcile with what opens under it
 * would be a bug the reader can see.
 */
export interface GroupCategorySlice {
  /** A current category code, an imported label, or null for unfiled. */
  readonly category: string | null;
  /** True when `category` is a code from the vocabulary rather than free text. */
  readonly known: boolean;
  readonly amount: bigint;
  /** Percent of everything spent in the window, one decimal. */
  readonly percent: number;
  readonly children: readonly SubcategorySlice[];
  /** What was filed under the category itself, with nothing under it. */
  readonly remainder: bigint;
}

/** Entries and money on one day of the week. */
export interface WeekdaySlice {
  /** 1 is Monday, 7 is Sunday — Luxon's numbering, and the row's order. */
  readonly weekday: number;
  readonly entryCount: number;
  readonly amount: bigint;
}

/** Every figure the screen shows for one window, in one currency. */
export interface GroupCurrencyStats {
  readonly currency: string;
  readonly totalSpent: bigint;
  /** Total spent less every income-like entry, for the netting toggle. */
  readonly netTotalSpent: bigint;
  readonly entryCount: number;
  /** Median entry, which one furniture run does not move. */
  readonly medianEntry: bigint;
  readonly perPersonMonth: bigint;
  readonly netPerPersonMonth: bigint;
  readonly flows: GroupFlows;
  readonly buckets: readonly SpendBucket[];
  /** Mean of the buckets, which the chart draws as a line. */
  readonly bucketMean: bigint;
  /**
   * The last three buckets against the average of everything before them, as
   * a whole percentage. Null when the series is too short to say anything.
   */
  readonly trendPercent: number | null;
  readonly members: readonly MemberStanding[];
  readonly categories: readonly GroupCategorySlice[];
  /** What the three largest categories come to together, one decimal. */
  readonly topThreePercent: number;
  /** Always seven, Monday first, quiet days included. */
  readonly weekdays: readonly WeekdaySlice[];
}

export interface GroupRangeStats {
  readonly key: StatsRange;
  readonly granularity: Granularity;
  /** Months the window covers, for the caption. Null for an empty all-time. */
  readonly months: number | null;
  readonly currencies: readonly GroupCurrencyStats[];
}

/** All-time facts, which no range switcher touches. */
export interface GroupRecords {
  readonly currency: string;
  readonly biggestEntry: {
    readonly description: string;
    readonly category: string | null;
    readonly subcategory: string | null;
    readonly date: string;
    readonly amount: bigint;
    readonly paidBy: string | null;
  } | null;
  /** The longest the group went with somebody not square. */
  readonly longestOpen: {
    readonly from: string;
    readonly to: string;
    readonly days: number;
  } | null;
  /** The longest everybody was at zero at once. */
  readonly longestSquare: {
    readonly from: string;
    readonly to: string;
    readonly days: number;
  } | null;
  readonly busiestWeek: {
    /** Monday of the week, as `YYYY-MM-DD`. */
    readonly start: string;
    readonly entryCount: number;
    readonly amount: bigint;
  } | null;
  readonly quietestMonth: {
    /** First day of the month, as `YYYY-MM-DD`. */
    readonly month: string;
    readonly entryCount: number;
    readonly amount: bigint;
  } | null;
}

export interface GroupStats {
  /** `3m`, `1y` and `all`, always all three and always in that order. */
  readonly ranges: readonly GroupRangeStats[];
  readonly records: readonly GroupRecords[];
  /** Currencies the group has spending in, busiest first. */
  readonly currencies: readonly string[];
  /** The day the group's first entry landed, or null when it has none. */
  readonly firstEntry: string | null;
  readonly memberCount: number;
}

export interface GroupStatsInput {
  readonly facts: readonly GroupStatsEntryFact[];
  readonly settlements: readonly StatsSettlementFact[];
  /** Everyone the group can name, removed people included. */
  readonly names: ReadonlyMap<string, string>;
  /** The people carrying the group now, in a stable order. */
  readonly memberIds: readonly string[];
  /**
   * Today's balance per currency and participant, from the balance engine.
   *
   * Read rather than derived: one place in this codebase turns facts into a
   * balance, and a statistics screen is not it.
   */
  readonly openBalances: ReadonlyMap<string, ReadonlyMap<string, bigint>>;
  /** The reader, when they are a participant — their row is marked, not moved. */
  readonly selfParticipantId: string | null;
  readonly timezone: string;
  readonly now: Date;
}

/**
 * Past this many months a monthly series stops fitting on a phone, so the
 * all-time window steps down to quarters. The same limit the member screen
 * uses, so the two never disagree about what "all" is drawn in.
 */
const MONTHLY_LIMIT = 24;

/** Descending on minor units, which is how every list here is ordered. */
function byAmountDesc(a: bigint, b: bigint): number {
  return b > a ? 1 : b < a ? -1 : 0;
}

/**
 * The middle entry, averaging the two middles on an even-length list.
 *
 * Integer arithmetic throughout: these are minor units, and the average of two
 * of them rounds half-up to a whole cent rather than going through a float.
 */
function medianOf(values: readonly bigint[]): bigint {
  if (values.length === 0) return 0n;
  const sorted = [...values].sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  const pair = sorted[middle - 1] + sorted[middle];
  return (pair + (pair < 0n ? -1n : 1n)) / 2n;
}

/** `value ÷ divisor`, rounded half away from zero. Zero for a zero divisor. */
function divide(value: bigint, divisor: bigint): bigint {
  if (divisor <= 0n) return 0n;
  const sign = value < 0n ? -1n : 1n;
  const magnitude = value < 0n ? -value : value;
  return (sign * (magnitude * 2n + divisor)) / (divisor * 2n);
}

/** Buckets the trend sentence reads as "lately", and the shortest series it will speak about. */
const TREND_BUCKETS = 3;
const TREND_MINIMUM = 6;

/**
 * How the tail of a series compares with the rest of it.
 *
 * The last three buckets against the average of everything before them, which
 * is the difference between "the group spends about this much" and "the group
 * has started spending more". Short series say nothing: three buckets out of
 * five is not a trend, it is most of the data.
 */
function trendOf(buckets: readonly SpendBucket[]): number | null {
  if (buckets.length < TREND_MINIMUM) return null;
  const split = buckets.length - TREND_BUCKETS;
  const sum = (rows: readonly SpendBucket[]) =>
    rows.reduce((total, bucket) => total + bucket.amount, 0n);
  const recent = divide(sum(buckets.slice(split)), BigInt(TREND_BUCKETS));
  const earlier = divide(sum(buckets.slice(0, split)), BigInt(split));
  if (earlier <= 0n) return null;
  return Number(((recent - earlier) * 100n) / earlier);
}

/** Inside the window, in one currency — either direction. */
function selectFacts(
  facts: readonly GroupStatsEntryFact[],
  currency: string,
  from: string | null,
  to: string,
): GroupStatsEntryFact[] {
  return facts.filter(
    (fact) =>
      fact.currency === currency &&
      (from === null || fact.expenseDate >= from) &&
      fact.expenseDate < to,
  );
}

/**
 * The pair a stored pair means today.
 *
 * A retired code is normalised to its replacement, so `housing` and
 * `utilities` land on `home` and are never drawn under a name the picker
 * stopped offering — and a subcategory that moved takes its parent with it,
 * so a row still saying `health` / `health_insurance` is counted under
 * Insurance and not under Health. Anything that is not a code at all — a
 * label an import kept verbatim — is passed through as itself: it is what
 * somebody actually wrote, and inventing a code for it would be a guess.
 *
 * The migration rewrites these rows; this is what covers the minutes during
 * an upgrade when a replica on the previous release is still writing them.
 */
function categoryKeyOf(
  value: string | null,
  subcategory: string | null = null,
): { key: string | null; child: string | null; known: boolean } {
  const pair = normalizeLegacyPair({ category: value, subcategory });
  if (pair.category) {
    return { key: pair.category, child: pair.subcategory, known: true };
  }
  return {
    key: value && value.length > 0 ? value : null,
    child: null,
    known: false,
  };
}

interface CategoryTally {
  amount: bigint;
  known: boolean;
  children: Map<string, bigint>;
}

function statsForCurrency(
  input: GroupStatsInput,
  currency: string,
  granularity: Granularity,
  from: string | null,
  to: string,
  months: number | null,
): GroupCurrencyStats {
  const { names, memberIds, openBalances, selfParticipantId, timezone } = input;
  const selected = selectFacts(input.facts, currency, from, to);

  let totalSpent = 0n;
  let revenue = 0n;
  let entryCount = 0;
  let revenueCount = 0;

  const entryTotals: bigint[] = [];
  const byCategory = new Map<string | null, CategoryTally>();
  const paidBy = new Map<string, bigint>();
  const shareBy = new Map<string, bigint>();
  const weekdays: WeekdaySlice[] = Array.from({ length: 7 }, (_, index) => ({
    weekday: index + 1,
    entryCount: 0,
    amount: 0n,
  }));

  const earliest = selected.reduce<string | null>(
    (first, fact) =>
      isSpending(fact.direction) && (first === null || fact.expenseDate < first)
        ? fact.expenseDate
        : first,
    null,
  );
  const starts =
    earliest === null
      ? []
      : bucketsFor(granularity, from ?? earliest, to, timezone);
  const buckets: SpendBucket[] = starts.map((start) => ({
    start,
    amount: 0n,
    entryCount: 0,
  }));

  for (const fact of selected) {
    const total = totalOf(fact);

    if (!isSpending(fact.direction)) {
      revenue += total;
      revenueCount += 1;
      continue;
    }

    totalSpent += total;
    entryCount += 1;
    entryTotals.push(total);

    for (const row of fact.payers) {
      paidBy.set(
        row.participantId,
        (paidBy.get(row.participantId) ?? 0n) + row.amount,
      );
    }
    for (const row of fact.shares) {
      shareBy.set(
        row.participantId,
        (shareBy.get(row.participantId) ?? 0n) + row.amount,
      );
    }

    const { key, child, known } = categoryKeyOf(
      fact.category,
      fact.subcategory,
    );
    const tally = byCategory.get(key) ?? {
      amount: 0n,
      known,
      children: new Map<string, bigint>(),
    };
    tally.amount += total;
    // A subcategory counts only under a parent that still admits it. One that
    // does not — `travel` / `flights`, filed before travel was retired — falls
    // into the parent's remainder, where it is reported as spending nobody has
    // filed rather than as a child of a category it never belonged to.
    if (known && key && child) {
      tally.children.set(child, (tally.children.get(child) ?? 0n) + total);
    }
    byCategory.set(key, tally);

    const index = bucketIndexOf(starts, fact.expenseDate);
    if (index !== null) {
      buckets[index] = {
        start: buckets[index].start,
        amount: buckets[index].amount + total,
        entryCount: buckets[index].entryCount + 1,
      };
    }

    const weekday =
      DateTime.fromISO(fact.expenseDate, { zone: timezone }).weekday - 1;
    weekdays[weekday] = {
      weekday: weekday + 1,
      entryCount: weekdays[weekday].entryCount + 1,
      amount: weekdays[weekday].amount + total,
    };
  }

  let settled = 0n;
  let settledCount = 0;
  for (const settlement of input.settlements) {
    if (settlement.currency !== currency) continue;
    if (from !== null && settlement.settledOn < from) continue;
    if (settlement.settledOn >= to) continue;
    settled += settlement.amount;
    settledCount += 1;
  }

  const open = openBalances.get(currency) ?? new Map<string, bigint>();
  // Everyone carrying the group now, plus anybody who has left but still shows
  // in these figures — a removed member's spending is still what the group
  // spent, and a row that vanished would leave the total unexplained.
  const standing = new Set<string>([
    ...memberIds,
    ...paidBy.keys(),
    ...shareBy.keys(),
  ]);
  for (const [participantId, amount] of open) {
    if (amount !== 0n) standing.add(participantId);
  }

  const members: MemberStanding[] = [...standing]
    .map((participantId) => {
      const paid = paidBy.get(participantId) ?? 0n;
      const share = shareBy.get(participantId) ?? 0n;
      return {
        participantId,
        name: names.get(participantId) ?? "",
        isSelf: participantId === selfParticipantId,
        paid,
        share,
        net: paid - share,
        open: open.get(participantId) ?? 0n,
      };
    })
    .sort((a, b) => byAmountDesc(a.share, b.share));

  const categories: GroupCategorySlice[] = [...byCategory.entries()]
    .map(([category, tally]) => {
      const children = [...tally.children.entries()]
        .sort((a, b) => byAmountDesc(a[1], b[1]))
        .map(([subcategory, amount]) => ({
          subcategory,
          amount,
          percent: percentOf(amount, tally.amount),
        }));
      const filed = children.reduce((sum, child) => sum + child.amount, 0n);
      return {
        category,
        known: tally.known,
        amount: tally.amount,
        percent: percentOf(tally.amount, totalSpent),
        children,
        // Subtraction, never a second sum: this is what makes the children and
        // the parent reconcile to the cent whatever the rounding did above.
        remainder: tally.amount - filed,
      };
    })
    .filter((slice) => slice.amount > 0n)
    .sort((a, b) => byAmountDesc(a.amount, b.amount));

  const topThree = categories
    .slice(0, 3)
    .reduce((sum, slice) => sum + slice.amount, 0n);

  const netTotalSpent = totalSpent - revenue;
  const divisor =
    BigInt(Math.max(1, input.memberIds.length)) * BigInt(months ?? 1);

  return {
    currency,
    totalSpent,
    netTotalSpent,
    entryCount,
    medianEntry: medianOf(entryTotals),
    perPersonMonth: divide(totalSpent, divisor),
    netPerPersonMonth: divide(netTotalSpent, divisor),
    flows: {
      spent: totalSpent,
      spentCount: entryCount,
      revenue,
      revenueCount,
      settled,
      settledCount,
    },
    buckets,
    bucketMean: divide(
      buckets.reduce((sum, bucket) => sum + bucket.amount, 0n),
      BigInt(buckets.length),
    ),
    trendPercent: trendOf(buckets),
    members,
    categories,
    topThreePercent: percentOf(topThree, totalSpent),
    weekdays,
  };
}

/** Which currencies the group has spending in, busiest first. */
function currenciesOf(facts: readonly GroupStatsEntryFact[]): string[] {
  const volume = new Map<string, bigint>();
  for (const fact of facts) {
    if (!isSpending(fact.direction)) continue;
    volume.set(
      fact.currency,
      (volume.get(fact.currency) ?? 0n) + totalOf(fact),
    );
  }
  return [...volume.entries()]
    .sort((a, b) =>
      b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[0].localeCompare(b[0]),
    )
    .map(([currency]) => currency);
}

function rangeStats(
  key: StatsRange,
  input: GroupStatsInput,
  currencies: readonly string[],
): GroupRangeStats {
  const { from, to } = windowOf(key, input.timezone, input.now);
  const earliest = input.facts.reduce<string | null>(
    (first, fact) =>
      isSpending(fact.direction) && (first === null || fact.expenseDate < first)
        ? fact.expenseDate
        : first,
    null,
  );

  const start = from ?? earliest;
  const months =
    start === null ? null : monthsBetween(start, to, input.timezone);
  const granularity: Granularity =
    key === "3m"
      ? "week"
      : months !== null && months > MONTHLY_LIMIT
        ? "quarter"
        : "month";

  return {
    key,
    granularity,
    months,
    currencies: currencies.map((currency) =>
      statsForCurrency(input, currency, granularity, from, to, months),
    ),
  };
}

/**
 * The days the group was square, and the days it was not.
 *
 * Replays the ledger day by day rather than reading today's balances: both
 * questions are historical, and a stretch that has since cleared is exactly
 * the one worth naming. The two runs come out of one pass because they are
 * the same pass — every day is one or the other.
 */
function streaksOf(
  facts: readonly GroupStatsEntryFact[],
  settlements: readonly StatsSettlementFact[],
  currency: string,
  today: string,
): Pick<GroupRecords, "longestOpen" | "longestSquare"> {
  const moves = new Map<string, Map<string, bigint>>();
  const move = (day: string, participantId: string, delta: bigint) => {
    if (delta === 0n) return;
    const forDay = moves.get(day) ?? new Map<string, bigint>();
    forDay.set(participantId, (forDay.get(participantId) ?? 0n) + delta);
    moves.set(day, forDay);
  };

  for (const fact of facts) {
    if (fact.currency !== currency) continue;
    const sign = isSpending(fact.direction) ? 1n : -1n;
    for (const row of fact.payers) {
      move(fact.expenseDate, row.participantId, sign * row.amount);
    }
    for (const row of fact.shares) {
      move(fact.expenseDate, row.participantId, -sign * row.amount);
    }
  }
  for (const settlement of settlements) {
    if (settlement.currency !== currency) continue;
    move(settlement.settledOn, settlement.fromParticipantId, settlement.amount);
    move(settlement.settledOn, settlement.toParticipantId, -settlement.amount);
  }

  const days = [...moves.keys()].sort();
  if (days.length === 0) return { longestOpen: null, longestSquare: null };

  const balances = new Map<string, bigint>();
  let openSince: string | null = null;
  let squareSince: string | null = null;
  let longestOpen: GroupRecords["longestOpen"] = null;
  let longestSquare: GroupRecords["longestSquare"] = null;

  const spanOf = (from: string, to: string): number =>
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000,
    );

  for (const day of [...days, today].sort()) {
    const forDay = moves.get(day);
    if (forDay) {
      for (const [participantId, delta] of forDay) {
        balances.set(
          participantId,
          (balances.get(participantId) ?? 0n) + delta,
        );
      }
    }
    const square = [...balances.values()].every((amount) => amount === 0n);

    if (square) {
      if (openSince !== null) {
        const days = spanOf(openSince, day);
        if (!longestOpen || days > longestOpen.days) {
          longestOpen = { from: openSince, to: day, days };
        }
        openSince = null;
      }
      squareSince ??= day;
    } else {
      if (squareSince !== null) {
        const days = spanOf(squareSince, day);
        if (!longestSquare || days > longestSquare.days) {
          longestSquare = { from: squareSince, to: day, days };
        }
        squareSince = null;
      }
      openSince ??= day;
    }
  }

  // A run still going on the day this is read counts, ending today.
  if (openSince !== null && openSince < today) {
    const days = spanOf(openSince, today);
    if (!longestOpen || days > longestOpen.days) {
      longestOpen = { from: openSince, to: today, days };
    }
  }
  if (squareSince !== null && squareSince < today) {
    const days = spanOf(squareSince, today);
    if (!longestSquare || days > longestSquare.days) {
      longestSquare = { from: squareSince, to: today, days };
    }
  }

  return { longestOpen, longestSquare };
}

/** The week with the most entries, Mondays as its keys. */
function busiestWeekOf(
  facts: readonly GroupStatsEntryFact[],
  currency: string,
  timezone: string,
): GroupRecords["busiestWeek"] {
  const weeks = new Map<string, { entryCount: number; amount: bigint }>();
  for (const fact of facts) {
    if (fact.currency !== currency || !isSpending(fact.direction)) continue;
    const start = DateTime.fromISO(fact.expenseDate, { zone: timezone })
      .startOf("week")
      .toISODate() as string;
    const running = weeks.get(start) ?? { entryCount: 0, amount: 0n };
    weeks.set(start, {
      entryCount: running.entryCount + 1,
      amount: running.amount + totalOf(fact),
    });
  }

  let busiest: GroupRecords["busiestWeek"] = null;
  for (const [start, week] of weeks) {
    if (
      !busiest ||
      week.entryCount > busiest.entryCount ||
      (week.entryCount === busiest.entryCount && week.amount > busiest.amount)
    ) {
      busiest = { start, ...week };
    }
  }
  return busiest;
}

/** The calendar month with the fewest entries, across the months spanned. */
function quietestMonthOf(
  facts: readonly GroupStatsEntryFact[],
  currency: string,
  timezone: string,
): GroupRecords["quietestMonth"] {
  const spending = facts.filter(
    (fact) => fact.currency === currency && isSpending(fact.direction),
  );
  if (spending.length === 0) return null;

  const counts = new Map<string, { entryCount: number; amount: bigint }>();
  let first: DateTime | null = null;
  let last: DateTime | null = null;
  for (const fact of spending) {
    const at = DateTime.fromISO(fact.expenseDate, { zone: timezone }).startOf(
      "month",
    );
    if (!first || at < first) first = at;
    if (!last || at > last) last = at;
    const key = at.toISODate() as string;
    const running = counts.get(key) ?? { entryCount: 0, amount: 0n };
    counts.set(key, {
      entryCount: running.entryCount + 1,
      amount: running.amount + totalOf(fact),
    });
  }
  if (!first || !last) return null;

  // Every month in between, gaps included: a month the group logged nothing in
  // is the quietest one there is, and skipping it would report the quietest
  // month that happens to have a row instead.
  let quietest: GroupRecords["quietestMonth"] = null;
  let cursor = first;
  for (let step = 0; cursor <= last && step < 600; step += 1) {
    const month = cursor.toISODate() as string;
    const entry = counts.get(month) ?? { entryCount: 0, amount: 0n };
    if (!quietest || entry.entryCount < quietest.entryCount) {
      quietest = { month, ...entry };
    }
    cursor = cursor.plus({ months: 1 });
  }
  return quietest;
}

function recordsFor(input: GroupStatsInput, currency: string): GroupRecords {
  const { facts, settlements, names, timezone, now } = input;
  const today = DateTime.fromJSDate(now, { zone: timezone })
    .startOf("day")
    .toISODate() as string;

  let biggestEntry: GroupRecords["biggestEntry"] = null;
  for (const fact of facts) {
    if (fact.currency !== currency || !isSpending(fact.direction)) continue;
    const total = totalOf(fact);
    if (biggestEntry && total <= biggestEntry.amount) continue;
    // Whoever put the most of it on their card, which is who a reader means by
    // "who paid for that" when an entry was split between two payers.
    const payer = [...fact.payers].sort((a, b) =>
      byAmountDesc(a.amount, b.amount),
    )[0];
    const filed = categoryKeyOf(fact.category, fact.subcategory);
    biggestEntry = {
      description: fact.description,
      category: filed.key,
      subcategory: filed.child,
      date: fact.expenseDate,
      amount: total,
      paidBy: payer ? (names.get(payer.participantId) ?? null) : null,
    };
  }

  return {
    currency,
    biggestEntry,
    ...streaksOf(facts, settlements, currency, today),
    busiestWeek: busiestWeekOf(facts, currency, timezone),
    quietestMonth: quietestMonthOf(facts, currency, timezone),
  };
}

export function computeGroupStats(input: GroupStatsInput): GroupStats {
  const currencies = currenciesOf(input.facts);
  const firstEntry = input.facts.reduce<string | null>(
    (first, fact) =>
      first === null || fact.expenseDate < first ? fact.expenseDate : first,
    null,
  );

  return {
    ranges: STATS_RANGES.map((key) => rangeStats(key, input, currencies)),
    records: currencies.map((currency) => recordsFor(input, currency)),
    currencies,
    firstEntry,
    memberCount: input.memberIds.length,
  };
}
