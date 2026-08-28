import { DateTime } from "luxon";
import { normalizeLegacyPair } from "@/modules/categorization/taxonomy";
import { isSpending, type EntryDirection } from "@/modules/expenses/direction";

/**
 * One member's statistics, derived from the group's own facts.
 *
 * This is the read model behind the member screen: what somebody put in
 * against what was theirs to carry, how that moved over time, where it went,
 * and who they keep ending up on an entry with.
 *
 * Two rules run through all of it.
 *
 * **Currencies stack, they never sum.** A group kept in euros and francs has
 * two of every figure here, and the screen shows two blocks. Adding them would
 * invent a number nobody spent.
 *
 * **Settlements are not spending.** Paying somebody back moves a balance; it
 * buys nothing. So repayments are excluded from paid, share, categories and
 * every total below — they only appear in the records, where "how fast did
 * they settle" is the question being asked.
 *
 * Everything here is pure: the loader in `member-stats-service.ts` reads the
 * rows, this decides what they mean.
 */

/** How far back the statistics look. Records and activity ignore it. */
export const STATS_RANGES = ["3m", "1y", "all"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

/** How the paid-against-share series is bucketed, which the range decides. */
export type Granularity = "week" | "month" | "quarter";

/** Days of the activity heatmap — 26 weeks, one square a day. */
export const ACTIVITY_DAYS = 182;

/**
 * Past this many months a monthly series stops fitting on a phone, so the
 * all-time window steps down to quarters rather than drawing 90 pairs of bars
 * two pixels wide.
 */
const MONTHLY_LIMIT = 24;

/** An entry, normalized to the currency the group balances in. */
export interface StatsEntryFact {
  readonly id: string;
  readonly description: string;
  readonly category: string | null;
  readonly direction: EntryDirection;
  /** Calendar day in the group's timezone, as `YYYY-MM-DD`. */
  readonly expenseDate: string;
  /** When the row was written — what "settled two hours later" is measured from. */
  readonly createdAt: Date;
  readonly currency: string;
  readonly payers: readonly { participantId: string; amount: bigint }[];
  readonly shares: readonly { participantId: string; amount: bigint }[];
}

/** A repayment, normalized the same way. */
export interface StatsSettlementFact {
  readonly id: string;
  readonly settledOn: string;
  readonly createdAt: Date;
  readonly currency: string;
  readonly fromParticipantId: string;
  readonly toParticipantId: string;
  readonly amount: bigint;
}

/** One bar pair of the paid-against-share series. */
export interface StatsBucket {
  /** First day the bucket covers, as `YYYY-MM-DD`. The screen labels it. */
  readonly start: string;
  readonly paid: bigint;
  readonly share: bigint;
}

/** One member's slice of the group's spend, for the comparison bar. */
export interface MemberShare {
  readonly participantId: string;
  readonly name: string;
  /** Percent of the group's spend, one decimal. */
  readonly percent: number;
  readonly isSubject: boolean;
}

export interface CategorySlice {
  /** A code from the categorization vocabulary, an imported label, or null. */
  readonly category: string | null;
  readonly amount: bigint;
  /** Percent of this member's share, one decimal. */
  readonly percent: number;
}

/** Somebody this member keeps sharing entries with. */
export interface SplitPartner {
  readonly participantId: string;
  readonly name: string;
  /** Entries both of them are on. */
  readonly entryCount: number;
  /** What those entries came to in full, not either person's share of them. */
  readonly amount: bigint;
}

/** Every figure the statistics block shows, for one currency. */
export interface MemberCurrencyStats {
  readonly currency: string;
  readonly paid: bigint;
  readonly share: bigint;
  /** Entries this member paid for or carries a share of. */
  readonly entryCount: number;
  readonly groupSpent: bigint;
  /** Paid ÷ share, to two decimals. Null when they carried no share. */
  readonly payerIndex: number | null;
  /** Their share of the group's spend, one decimal. */
  readonly sharePercent: number;
  /** 1 is the largest share in the group. */
  readonly rank: number;
  /** What every member's share would be if the group split evenly. */
  readonly evenPercent: number;
  /** The middle member's share, so an outlier can be read as one. */
  readonly medianPercent: number;
  readonly members: readonly MemberShare[];
  readonly buckets: readonly StatsBucket[];
  readonly categories: readonly CategorySlice[];
  readonly partners: readonly SplitPartner[];
  /** Share of this member's entries the first partner also appears on. */
  readonly topPartnerPercent: number | null;
}

export interface MemberRangeStats {
  readonly key: StatsRange;
  readonly granularity: Granularity;
  /** Months the window covers, for the caption. Null for an empty all-time. */
  readonly months: number | null;
  readonly currencies: readonly MemberCurrencyStats[];
}

/** One square of the heatmap. */
export interface ActivityDay {
  readonly date: string;
  readonly count: number;
  /** This member's share that day, per currency. Empty on a quiet day. */
  readonly amounts: readonly { currency: string; amount: bigint }[];
}

export interface MemberActivity {
  /** Oldest first, exactly `ACTIVITY_DAYS` long, gaps filled with zeroes. */
  readonly days: readonly ActivityDay[];
  /** Longest run of consecutive days with an entry, inside the window. */
  readonly longestRun: number;
  /** The run ending today, which is 0 unless they logged something today. */
  readonly currentRun: number;
}

/** All-time records, one set per currency. */
export interface MemberRecords {
  readonly currency: string;
  readonly biggestBill: {
    readonly description: string;
    readonly category: string | null;
    readonly date: string;
    readonly amount: bigint;
  } | null;
  /** The longest they went without being square in this currency. */
  readonly longestDebt: {
    readonly from: string;
    readonly to: string;
    readonly days: number;
    /** Whether they were owing (`negative`) or owed (`positive`) at the start. */
    readonly owing: boolean;
  } | null;
  /** Shortest gap between owing on an entry and paying somebody back. */
  readonly fastestSettle: {
    readonly hours: number;
    readonly on: string;
  } | null;
  /** The calendar month with the fewest entries, across the months they span. */
  readonly quietestMonth: {
    /** First day of the month, as `YYYY-MM-DD`. */
    readonly month: string;
    readonly entryCount: number;
    readonly amount: bigint;
  } | null;
}

export interface MemberStats {
  /** `3m`, `1y` and `all`, always all three and always in that order. */
  readonly ranges: readonly MemberRangeStats[];
  readonly activity: MemberActivity;
  readonly records: readonly MemberRecords[];
  /** The day their first entry landed, or null when they have none. */
  readonly firstEntry: string | null;
  /** Currencies they have any spending in, busiest first. */
  readonly currencies: readonly string[];
}

export interface MemberStatsInput {
  readonly facts: readonly StatsEntryFact[];
  readonly settlements: readonly StatsSettlementFact[];
  readonly participantId: string;
  /** Everyone the group can name, so a partner row is never blank. */
  readonly names: ReadonlyMap<string, string>;
  /** Members counted for "an even split would be", removed people included. */
  readonly memberCount: number;
  readonly timezone: string;
  readonly now: Date;
}

/**
 * The category a stored code means today, or the label somebody imported.
 *
 * The same rule `group-stats.ts` follows: a retired code is drawn under its
 * replacement, and free text is drawn as itself. Without this a group whose
 * upgrade is minutes old shows `fees` and `finance_admin` as two slices, and
 * the first of them with no label and no icon.
 */
function categoryKeyOf(value: string | null): string | null {
  const pair = normalizeLegacyPair({ category: value });
  if (pair.category) return pair.category;
  return value && value.length > 0 ? value : null;
}

/** Sums one participant's side of an entry. */
function amountFor(
  rows: readonly { participantId: string; amount: bigint }[],
  participantId: string,
): bigint {
  let total = 0n;
  for (const row of rows) {
    if (row.participantId === participantId) total += row.amount;
  }
  return total;
}

/** Whole minor units of the entry, which is what either side sums to. */
export function totalOf(fact: StatsEntryFact): bigint {
  let total = 0n;
  for (const payer of fact.payers) total += payer.amount;
  return total;
}

/**
 * A percentage of `whole`, rounded half-up to one decimal.
 *
 * Integer arithmetic all the way down: the inputs are minor units held as
 * `bigint`, and going through a float to divide them is exactly the habit the
 * money types exist to prevent.
 */
export function percentOf(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  const scaled = (part * 2000n + whole) / (whole * 2n);
  return Number(scaled) / 10;
}

/** Paid ÷ share to two decimals, or null when there is no share to divide by. */
export function payerIndexOf(paid: bigint, share: bigint): number | null {
  if (share <= 0n) return null;
  return Number((paid * 200n + share) / (share * 2n)) / 100;
}

/** The middle value, averaging the two middles on an even-length list. */
function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
}

/** The window a range covers, as plain days. `from` is null for all time. */
export function windowOf(
  range: StatsRange,
  timezone: string,
  now: Date,
): { from: string | null; to: string } {
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf("day");
  const to = today.plus({ days: 1 }).toISODate() as string;
  if (range === "all") return { from: null, to };
  const months = range === "3m" ? 3 : 12;
  return { from: today.minus({ months }).toISODate() as string, to };
}

/**
 * The buckets a window is drawn in, oldest first.
 *
 * Three months are weeks, a year is months, and all time is months until the
 * span outgrows a phone screen and becomes quarters. The list is built from
 * the calendar rather than from the data so a quiet month is a gap in the
 * series and not a bucket that silently disappears.
 */
export function bucketsFor(
  granularity: Granularity,
  from: string,
  to: string,
  timezone: string,
): string[] {
  const unit =
    granularity === "week"
      ? "week"
      : granularity === "quarter"
        ? "quarter"
        : "month";
  const step =
    granularity === "week"
      ? { weeks: 1 }
      : granularity === "quarter"
        ? { months: 3 }
        : { months: 1 };
  const end = DateTime.fromISO(to, { zone: timezone })
    .minus({ days: 1 })
    .startOf(unit);

  let cursor = DateTime.fromISO(from, { zone: timezone }).startOf(unit);
  const starts: string[] = [];
  // Bounded by the range's own length; the guard is only there so a bad
  // timezone cannot spin forever.
  while (cursor <= end && starts.length < 400) {
    starts.push(cursor.toISODate() as string);
    cursor = cursor.plus(step);
  }
  return starts;
}

/** Which bucket a calendar day falls in, or null when it falls outside. */
export function bucketIndexOf(
  starts: readonly string[],
  day: string,
): number | null {
  // Linear scan from the end: the series is at most a few dozen long and the
  // facts arrive roughly in date order, so this beats a map allocation.
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    if (day >= starts[index]) return index;
  }
  return null;
}

/** Spending only, inside the window, in one currency. */
function selectFacts(
  facts: readonly StatsEntryFact[],
  currency: string,
  from: string | null,
  to: string,
): StatsEntryFact[] {
  return facts.filter(
    (fact) =>
      isSpending(fact.direction) &&
      fact.currency === currency &&
      (from === null || fact.expenseDate >= from) &&
      fact.expenseDate < to,
  );
}

function statsForCurrency(
  facts: readonly StatsEntryFact[],
  input: MemberStatsInput,
  currency: string,
  granularity: Granularity,
  from: string | null,
  to: string,
): MemberCurrencyStats {
  const { participantId, names, memberCount, timezone } = input;
  const selected = selectFacts(facts, currency, from, to);

  let paid = 0n;
  let share = 0n;
  let groupSpent = 0n;
  let entryCount = 0;

  const byMember = new Map<string, bigint>();
  const byCategory = new Map<string | null, bigint>();
  const partnerEntries = new Map<string, number>();
  const partnerVolume = new Map<string, bigint>();

  const earliest = selected.reduce<string | null>(
    (first, fact) =>
      first === null || fact.expenseDate < first ? fact.expenseDate : first,
    null,
  );
  const starts =
    earliest === null
      ? []
      : bucketsFor(granularity, from ?? earliest, to, timezone);
  const buckets = starts.map((start) => ({ start, paid: 0n, share: 0n }));

  for (const fact of selected) {
    const total = totalOf(fact);
    groupSpent += total;
    for (const row of fact.shares) {
      byMember.set(
        row.participantId,
        (byMember.get(row.participantId) ?? 0n) + row.amount,
      );
    }

    const mePaid = amountFor(fact.payers, participantId);
    const myShare = amountFor(fact.shares, participantId);
    if (mePaid === 0n && myShare === 0n) continue;

    entryCount += 1;
    paid += mePaid;
    share += myShare;
    const filed = categoryKeyOf(fact.category);
    byCategory.set(filed, (byCategory.get(filed) ?? 0n) + myShare);

    const index = bucketIndexOf(starts, fact.expenseDate);
    if (index !== null) {
      buckets[index] = {
        start: buckets[index].start,
        paid: buckets[index].paid + mePaid,
        share: buckets[index].share + myShare,
      };
    }

    // Everybody else on the entry, counted once however many ways they appear
    // on it — being both payer and sharer is one shared entry, not two.
    const others = new Set<string>();
    for (const row of [...fact.payers, ...fact.shares]) {
      if (row.participantId !== participantId) others.add(row.participantId);
    }
    for (const other of others) {
      partnerEntries.set(other, (partnerEntries.get(other) ?? 0) + 1);
      partnerVolume.set(other, (partnerVolume.get(other) ?? 0n) + total);
    }
  }

  const members: MemberShare[] = [...byMember.entries()]
    // Sorted on the minor units rather than on the rounded percentage, so two
    // members a cent apart still rank in the order they actually spent.
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([id, amount]) => ({
      participantId: id,
      name: names.get(id) ?? "",
      percent: percentOf(amount, groupSpent),
      isSubject: id === participantId,
    }));

  const rank = members.findIndex((member) => member.isSubject) + 1;

  const categories: CategorySlice[] = [...byCategory.entries()]
    .filter(([, amount]) => amount > 0n)
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([category, amount]) => ({
      category,
      amount,
      percent: percentOf(amount, share),
    }));

  const partners: SplitPartner[] = [...partnerEntries.entries()]
    .map(([id, count]) => ({
      participantId: id,
      name: names.get(id) ?? "",
      entryCount: count,
      amount: partnerVolume.get(id) ?? 0n,
    }))
    .sort((a, b) =>
      b.entryCount !== a.entryCount
        ? b.entryCount - a.entryCount
        : b.amount > a.amount
          ? 1
          : b.amount < a.amount
            ? -1
            : 0,
    )
    .slice(0, 4);

  return {
    currency,
    paid,
    share,
    entryCount,
    groupSpent,
    payerIndex: payerIndexOf(paid, share),
    sharePercent: percentOf(share, groupSpent),
    rank: rank === 0 ? members.length + 1 : rank,
    evenPercent: memberCount > 0 ? Math.round(1000 / memberCount) / 10 : 0,
    medianPercent: medianOf(members.map((member) => member.percent)),
    members,
    buckets,
    categories,
    partners,
    topPartnerPercent:
      partners.length > 0 && entryCount > 0
        ? Math.round((partners[0].entryCount / entryCount) * 1000) / 10
        : null,
  };
}

/** Which currencies this member has spending in, busiest first. */
function currenciesOf(
  facts: readonly StatsEntryFact[],
  participantId: string,
): string[] {
  const volume = new Map<string, bigint>();
  for (const fact of facts) {
    if (!isSpending(fact.direction)) continue;
    const mine =
      amountFor(fact.payers, participantId) +
      amountFor(fact.shares, participantId);
    if (mine === 0n) continue;
    volume.set(fact.currency, (volume.get(fact.currency) ?? 0n) + mine);
  }
  return [...volume.entries()]
    .sort((a, b) =>
      b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[0].localeCompare(b[0]),
    )
    .map(([currency]) => currency);
}

/** Whole months a window spans, for the chart's caption. */
export function monthsBetween(
  from: string,
  to: string,
  timezone: string,
): number {
  const start = DateTime.fromISO(from, { zone: timezone });
  const end = DateTime.fromISO(to, { zone: timezone });
  return Math.max(1, Math.round(end.diff(start, "months").months));
}

function rangeStats(
  key: StatsRange,
  input: MemberStatsInput,
  currencies: readonly string[],
): MemberRangeStats {
  const { from, to } = windowOf(key, input.timezone, input.now);
  const spending = input.facts.filter((fact) => isSpending(fact.direction));
  const earliest = spending.reduce<string | null>(
    (first, fact) =>
      first === null || fact.expenseDate < first ? fact.expenseDate : first,
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
      statsForCurrency(input.facts, input, currency, granularity, from, to),
    ),
  };
}

/**
 * Entries per day over the last 26 weeks, plus the two run lengths.
 *
 * Counting entries rather than money on purpose: the heatmap answers "were
 * they around", and one big bill and one small one are the same amount of
 * being around. The amounts ride along for the tooltip, per currency.
 */
export function activityOf(input: MemberStatsInput): MemberActivity {
  const { participantId, timezone, now } = input;
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf("day");
  const first = today.minus({ days: ACTIVITY_DAYS - 1 });
  const from = first.toISODate() as string;
  const to = today.toISODate() as string;

  const counts = new Map<string, number>();
  const amounts = new Map<string, Map<string, bigint>>();

  for (const fact of input.facts) {
    if (!isSpending(fact.direction)) continue;
    if (fact.expenseDate < from || fact.expenseDate > to) continue;
    const mine =
      amountFor(fact.payers, participantId) +
      amountFor(fact.shares, participantId);
    if (mine === 0n) continue;

    counts.set(fact.expenseDate, (counts.get(fact.expenseDate) ?? 0) + 1);
    const byCurrency = amounts.get(fact.expenseDate) ?? new Map();
    byCurrency.set(
      fact.currency,
      (byCurrency.get(fact.currency) ?? 0n) +
        amountFor(fact.shares, participantId),
    );
    amounts.set(fact.expenseDate, byCurrency);
  }

  const days: ActivityDay[] = [];
  let longestRun = 0;
  let run = 0;
  for (let offset = 0; offset < ACTIVITY_DAYS; offset += 1) {
    const date = first.plus({ days: offset }).toISODate() as string;
    const count = counts.get(date) ?? 0;
    run = count > 0 ? run + 1 : 0;
    if (run > longestRun) longestRun = run;
    days.push({
      date,
      count,
      amounts: [...(amounts.get(date) ?? new Map())]
        .filter(([, amount]) => amount !== 0n)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([currency, amount]) => ({ currency, amount })),
    });
  }

  return { days, longestRun, currentRun: run };
}

/**
 * The longest stretch this member was not square, in one currency.
 *
 * Replays the ledger day by day rather than reading today's balance: the
 * question is historical, and a balance that has since cleared is exactly the
 * one worth naming. A stretch still open on the last day counts, ending there.
 */
function longestDebtOf(
  facts: readonly StatsEntryFact[],
  settlements: readonly StatsSettlementFact[],
  participantId: string,
  currency: string,
  today: string,
): MemberRecords["longestDebt"] {
  const moves = new Map<string, bigint>();
  const move = (day: string, delta: bigint) => {
    moves.set(day, (moves.get(day) ?? 0n) + delta);
  };

  for (const fact of facts) {
    if (fact.currency !== currency) continue;
    const sign = isSpending(fact.direction) ? 1n : -1n;
    const delta =
      sign *
      (amountFor(fact.payers, participantId) -
        amountFor(fact.shares, participantId));
    if (delta !== 0n) move(fact.expenseDate, delta);
  }
  for (const settlement of settlements) {
    if (settlement.currency !== currency) continue;
    if (settlement.fromParticipantId === participantId) {
      move(settlement.settledOn, settlement.amount);
    } else if (settlement.toParticipantId === participantId) {
      move(settlement.settledOn, -settlement.amount);
    }
  }

  const days = [...moves.keys()].sort();
  if (days.length === 0) return null;

  let balance = 0n;
  let openedOn: string | null = null;
  let openedOwing = false;
  let best: MemberRecords["longestDebt"] = null;

  const close = (end: string) => {
    const from = openedOn;
    if (from === null) return;
    const span = Math.round(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000,
    );
    if (!best || span > best.days) {
      best = { from, to: end, days: span, owing: openedOwing };
    }
    openedOn = null;
  };

  for (const day of days) {
    const before = balance;
    balance += moves.get(day) ?? 0n;
    if (before === 0n && balance !== 0n) {
      openedOn = day;
      openedOwing = balance < 0n;
    } else if (before !== 0n && balance === 0n) {
      close(day);
    }
  }
  close(today);

  return best;
}

/**
 * The quickest this member ever cleared something they owed.
 *
 * Measured from the entry that put them in the red to the repayment that
 * followed it, both by the instant the row was written — which is what the
 * reader saw happen, and the only pair of timestamps in the data precise
 * enough to say "two hours".
 */
function fastestSettleOf(
  facts: readonly StatsEntryFact[],
  settlements: readonly StatsSettlementFact[],
  participantId: string,
  currency: string,
): MemberRecords["fastestSettle"] {
  const owing = facts
    .filter(
      (fact) =>
        fact.currency === currency &&
        isSpending(fact.direction) &&
        amountFor(fact.shares, participantId) >
          amountFor(fact.payers, participantId),
    )
    .map((fact) => fact.createdAt.getTime())
    .sort((a, b) => a - b);
  if (owing.length === 0) return null;

  let best: { hours: number; on: string } | null = null;
  for (const settlement of settlements) {
    if (settlement.currency !== currency) continue;
    if (settlement.fromParticipantId !== participantId) continue;
    const paidAt = settlement.createdAt.getTime();
    // The last entry that landed before the repayment: anything after it was
    // not what this payment answered.
    let previous: number | null = null;
    for (const at of owing) {
      if (at > paidAt) break;
      previous = at;
    }
    if (previous === null) continue;
    const hours = Math.round(((paidAt - previous) / 3_600_000) * 10) / 10;
    if (!best || hours < best.hours) {
      best = { hours, on: settlement.settledOn };
    }
  }
  return best;
}

/** The calendar month with the fewest entries, across the months they span. */
function quietestMonthOf(
  facts: readonly StatsEntryFact[],
  participantId: string,
  currency: string,
  timezone: string,
): MemberRecords["quietestMonth"] {
  const mine = facts.filter(
    (fact) =>
      fact.currency === currency &&
      isSpending(fact.direction) &&
      (amountFor(fact.payers, participantId) !== 0n ||
        amountFor(fact.shares, participantId) !== 0n),
  );
  if (mine.length === 0) return null;

  const counts = new Map<string, { entryCount: number; amount: bigint }>();
  let first: DateTime | null = null;
  let last: DateTime | null = null;
  for (const fact of mine) {
    const at = DateTime.fromISO(fact.expenseDate, { zone: timezone }).startOf(
      "month",
    );
    if (!first || at < first) first = at;
    if (!last || at > last) last = at;
    const key = at.toISODate() as string;
    const running = counts.get(key) ?? { entryCount: 0, amount: 0n };
    counts.set(key, {
      entryCount: running.entryCount + 1,
      amount: running.amount + amountFor(fact.shares, participantId),
    });
  }
  if (!first || !last) return null;

  // Every month between their first entry and their last, gaps included: a
  // month they logged nothing in is the quietest one there is, and skipping it
  // would report the quietest month they happened to appear in instead.
  let quietest: { month: string; entryCount: number; amount: bigint } | null =
    null;
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

function recordsFor(input: MemberStatsInput, currency: string): MemberRecords {
  const { facts, settlements, participantId, timezone, now } = input;
  const today = DateTime.fromJSDate(now, { zone: timezone })
    .startOf("day")
    .toISODate() as string;

  let biggestBill: MemberRecords["biggestBill"] = null;
  for (const fact of facts) {
    if (fact.currency !== currency || !isSpending(fact.direction)) continue;
    const mine = amountFor(fact.payers, participantId);
    if (mine === 0n) continue;
    if (!biggestBill || mine > biggestBill.amount) {
      biggestBill = {
        description: fact.description,
        category: categoryKeyOf(fact.category),
        date: fact.expenseDate,
        amount: mine,
      };
    }
  }

  return {
    currency,
    biggestBill,
    longestDebt: longestDebtOf(
      facts,
      settlements,
      participantId,
      currency,
      today,
    ),
    fastestSettle: fastestSettleOf(facts, settlements, participantId, currency),
    quietestMonth: quietestMonthOf(facts, participantId, currency, timezone),
  };
}

export function computeMemberStats(input: MemberStatsInput): MemberStats {
  const currencies = currenciesOf(input.facts, input.participantId);
  const spending = input.facts.filter(
    (fact) =>
      isSpending(fact.direction) &&
      (amountFor(fact.payers, input.participantId) !== 0n ||
        amountFor(fact.shares, input.participantId) !== 0n),
  );
  const firstEntry = spending.reduce<string | null>(
    (first, fact) =>
      first === null || fact.expenseDate < first ? fact.expenseDate : first,
    null,
  );

  return {
    ranges: STATS_RANGES.map((key) => rangeStats(key, input, currencies)),
    activity: activityOf(input),
    records: currencies.map((currency) => recordsFor(input, currency)),
    firstEntry,
    currencies,
  };
}
