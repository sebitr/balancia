import { DateTime } from "luxon";

/**
 * Recurring occurrence calculation.
 *
 * Pure and timezone-aware. "The 1st of every month at midnight" means midnight
 * *in the group's timezone*, so a group in Auckland and one in Los Angeles
 * generate their rent expense on different absolute instants — which is the
 * behaviour a person expects and a naive UTC calculation gets wrong twice a
 * year around daylight-saving transitions.
 *
 * Everything here works on calendar dates (`YYYY-MM-DD`) plus a timezone, and
 * only converts to an absolute instant at the very end.
 */

/** The frequencies, in the order the sheet offers them. */
export const RECURRENCE_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
] as const;

export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** The weeks an nth-weekday rule can name. */
export const WEEKS_OF_MONTH = [1, 2, 3, 4, "last"] as const;

/**
 * Which week of the month an nth-weekday rule means.
 *
 * 1–4 count from the start. `last` counts from the end rather than being a
 * fifth week, because most months do not have five of a given weekday and
 * "the last Friday" is what people mean when they say it — a rule that
 * silently skipped February would be the same bug as a 31st that skipped it.
 */
export type WeekOfMonth = (typeof WEEKS_OF_MONTH)[number];

export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency;
  /** Every N periods; 2 + weekly = fortnightly. */
  readonly interval: number;
  /**
   * ISO weekday 1 (Monday) – 7 (Sunday).
   *
   * Weekly, and monthly when `weekOfMonth` is set — "the second Tuesday" is
   * this plus that.
   */
  readonly weekday?: number | null;
  /**
   * Which occurrence of `weekday` within the month. Monthly only.
   *
   * When set it replaces `dayOfMonth`: a rule is either "on the 3rd" or "on
   * the second Tuesday", never both. `validateRule` refuses the pair rather
   * than picking a winner, because either choice would be a guess about what
   * somebody meant.
   */
  readonly weekOfMonth?: WeekOfMonth | null;
  /** 1–31, clamped to the last day of short months. Monthly and yearly. */
  readonly dayOfMonth?: number | null;
  /** 1–12. Yearly only. */
  readonly monthOfYear?: number | null;
  /** IANA timezone the schedule is interpreted in. */
  readonly timezone: string;
  /** First eligible date, inclusive (YYYY-MM-DD). */
  readonly startDate: string;
  /** Last eligible date, inclusive (YYYY-MM-DD). */
  readonly endDate?: string | null;
  /**
   * Stop after this many occurrences, counting from the first.
   *
   * The other way a schedule ends, and it cannot be expressed as a date: "12
   * times" over a monthly rule is a year, over a daily one is a fortnight, and
   * resolving it to an end date at creation would freeze an answer that the
   * interval is still free to change.
   *
   * It is a property of the whole series, so a function that sees one
   * occurrence cannot enforce it — `nextOccurrence` deliberately ignores it,
   * and `occurrencesUpTo` is where it is applied. See `remainingOf`.
   */
  readonly count?: number | null;
}

export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecurrenceError";
  }
}

function parseDate(value: string, timezone: string): DateTime {
  const parsed = DateTime.fromISO(value, { zone: timezone });
  if (!parsed.isValid) {
    throw new RecurrenceError(
      `Invalid date "${value}" for timezone "${timezone}": ${parsed.invalidReason ?? "unknown reason"}`,
    );
  }
  return parsed.startOf("day");
}

function validateRule(rule: RecurrenceRule): void {
  if (!Number.isInteger(rule.interval) || rule.interval < 1) {
    throw new RecurrenceError("Recurrence interval must be a positive integer");
  }
  if (rule.weekday != null && (rule.weekday < 1 || rule.weekday > 7)) {
    throw new RecurrenceError(
      "Weekday must be between 1 (Monday) and 7 (Sunday)",
    );
  }
  if (rule.weekOfMonth != null) {
    if (rule.frequency !== "monthly") {
      throw new RecurrenceError(
        "A week of the month only means something on a monthly rule",
      );
    }
    if (rule.weekday == null) {
      throw new RecurrenceError(
        "A week of the month needs the weekday it is counting",
      );
    }
    if (rule.dayOfMonth != null) {
      // Refused rather than resolved: "the 3rd" and "the second Tuesday" are
      // different rules, and picking one would be a guess about which was
      // meant.
      throw new RecurrenceError(
        "A rule is either on a day of the month or on a weekday of it, not both",
      );
    }
  }
  if (
    rule.dayOfMonth != null &&
    (rule.dayOfMonth < 1 || rule.dayOfMonth > 31)
  ) {
    throw new RecurrenceError("Day of month must be between 1 and 31");
  }
  if (rule.count != null && (!Number.isInteger(rule.count) || rule.count < 1)) {
    throw new RecurrenceError("An occurrence count must be a positive integer");
  }
  if (
    rule.monthOfYear != null &&
    (rule.monthOfYear < 1 || rule.monthOfYear > 12)
  ) {
    throw new RecurrenceError("Month must be between 1 and 12");
  }
  if (!DateTime.local().setZone(rule.timezone).isValid) {
    throw new RecurrenceError(`Unknown timezone "${rule.timezone}"`);
  }
}

/**
 * Clamps a day-of-month to a month's real length: a template set to the 31st
 * fires on the 30th in April and the 28th (or 29th) in February, rather than
 * skipping those months entirely.
 */
function withDayOfMonth(base: DateTime, dayOfMonth: number): DateTime {
  return base.set({ day: Math.min(dayOfMonth, base.daysInMonth ?? 28) });
}

/**
 * The nth `weekday` of `base`'s month — "the second Tuesday", "the last
 * Friday".
 *
 * `last` walks back from the end of the month rather than taking the fifth,
 * which is the same clamping instinct `withDayOfMonth` follows: a rule must
 * not skip the months that are too short to satisfy it literally. Asking for
 * the 5th Tuesday of a month with four is the one case that cannot be
 * honoured, and it clamps to the fourth for the same reason.
 */
function withWeekdayOfMonth(
  base: DateTime,
  weekday: number,
  week: WeekOfMonth,
): DateTime {
  const first = base.startOf("month");

  if (week === "last") {
    const last = base.endOf("month").startOf("day");
    return last.minus({ days: (last.weekday - weekday + 7) % 7 });
  }

  const offset = (weekday - first.weekday + 7) % 7;
  const candidate = first.plus({ days: offset + (week - 1) * 7 });
  // Clamp rather than roll into the next month.
  return candidate.month === first.month
    ? candidate
    : candidate.minus({ weeks: 1 });
}

/** The day a monthly rule lands on within `base`'s month. */
function monthlyDayIn(
  base: DateTime,
  rule: RecurrenceRule,
  fallbackDay: number,
): DateTime {
  if (rule.weekOfMonth != null && rule.weekday != null) {
    return withWeekdayOfMonth(base, rule.weekday, rule.weekOfMonth);
  }
  return withDayOfMonth(base, rule.dayOfMonth ?? fallbackDay);
}

/**
 * The first occurrence on or after `startDate`, aligned to the rule's weekday
 * or day-of-month.
 */
export function firstOccurrence(rule: RecurrenceRule): string | null {
  validateRule(rule);
  const start = parseDate(rule.startDate, rule.timezone);

  let candidate: DateTime;
  switch (rule.frequency) {
    case "daily":
      // Every day starting today: the start date is already the first one.
      candidate = start;
      break;
    case "weekly": {
      const targetWeekday = rule.weekday ?? start.weekday;
      const delta = (targetWeekday - start.weekday + 7) % 7;
      candidate = start.plus({ days: delta });
      break;
    }
    case "monthly": {
      candidate = monthlyDayIn(start, rule, start.day);
      if (candidate < start) {
        candidate = monthlyDayIn(start.plus({ months: 1 }), rule, start.day);
      }
      break;
    }
    case "yearly": {
      const targetMonth = rule.monthOfYear ?? start.month;
      const targetDay = rule.dayOfMonth ?? start.day;
      candidate = withDayOfMonth(start.set({ month: targetMonth }), targetDay);
      if (candidate < start) {
        candidate = withDayOfMonth(
          start.plus({ years: 1 }).set({ month: targetMonth }),
          targetDay,
        );
      }
      break;
    }
  }

  return withinRange(candidate, rule) ? candidate.toISODate() : null;
}

/** The occurrence strictly after `previous`, or null once the rule has ended. */
export function nextOccurrence(
  rule: RecurrenceRule,
  previous: string,
): string | null {
  validateRule(rule);
  const previousDate = parseDate(previous, rule.timezone);

  let candidate: DateTime;
  switch (rule.frequency) {
    case "daily":
      candidate = previousDate.plus({ days: rule.interval });
      break;
    case "weekly":
      candidate = previousDate.plus({ weeks: rule.interval });
      break;
    case "monthly": {
      // Step from the first of the month so a clamped 31st does not drag the
      // schedule backwards (Jan 31 → Feb 28 → Mar 28 would be wrong). An
      // nth-weekday rule needs the same base for the same reason: it is
      // recomputed within each month rather than counted forward in days.
      const base = previousDate
        .startOf("month")
        .plus({ months: rule.interval });
      candidate = monthlyDayIn(base, rule, previousDate.day);
      break;
    }
    case "yearly": {
      const targetDay = rule.dayOfMonth ?? previousDate.day;
      const base = previousDate.startOf("month").plus({ years: rule.interval });
      candidate = withDayOfMonth(base, targetDay);
      break;
    }
  }

  return withinRange(candidate, rule) ? candidate.toISODate() : null;
}

function withinRange(candidate: DateTime, rule: RecurrenceRule): boolean {
  if (!candidate.isValid) return false;
  const start = parseDate(rule.startDate, rule.timezone);
  if (candidate < start) return false;
  if (rule.endDate) {
    const end = parseDate(rule.endDate, rule.timezone);
    if (candidate > end) return false;
  }
  return true;
}

/**
 * Every occurrence from the rule's start up to and including `until`.
 *
 * The worker uses this to catch up after downtime: a template that should have
 * fired three times while the container was down produces all three, each with
 * its own occurrence date, and the uniqueness constraint keeps a second run
 * from duplicating them.
 */
export function occurrencesUpTo(
  rule: RecurrenceRule,
  until: string,
  options: {
    from?: string | null;
    maxOccurrences?: number;
    /**
     * How many of this series already exist, for a rule that ends after a
     * count. The worker knows: it is the template's `generatedCount`.
     *
     * Without it a caller resuming from `from` would start counting at zero
     * and the series would never end.
     */
    alreadyGenerated?: number;
  } = {},
): string[] {
  validateRule(rule);
  const untilDate = parseDate(until, rule.timezone);
  const limit = Math.min(
    options.maxOccurrences ?? 500,
    remainingOf(rule, options.alreadyGenerated ?? 0),
  );
  if (limit <= 0) return [];

  const occurrences: string[] = [];
  let current = options.from
    ? nextOccurrence(rule, options.from)
    : firstOccurrence(rule);

  while (current && occurrences.length < limit) {
    const currentDate = parseDate(current, rule.timezone);
    if (currentDate > untilDate) break;
    occurrences.push(current);
    current = nextOccurrence(rule, current);
  }

  return occurrences;
}

/**
 * How many occurrences a rule has left, given how many it has already had.
 *
 * `Infinity` when it ends on a date or never — the caller's own limit then
 * decides, which is what happened before counts existed.
 */
export function remainingOf(
  rule: RecurrenceRule,
  alreadyGenerated: number,
): number {
  if (rule.count == null) return Infinity;
  return Math.max(0, rule.count - alreadyGenerated);
}

/**
 * The next `howMany` occurrences from the start of the series.
 *
 * What the recurrence sheet previews. It counts from the beginning rather
 * than from today on purpose: a rule that ends after 12 times has to know
 * where in the twelve it is, and a preview built while somebody is still
 * choosing the rule has no history to consult.
 */
export function upcomingOccurrences(
  rule: RecurrenceRule,
  howMany: number,
): string[] {
  validateRule(rule);
  const limit = Math.min(howMany, remainingOf(rule, 0));

  const dates: string[] = [];
  let current = firstOccurrence(rule);
  while (current && dates.length < limit) {
    dates.push(current);
    current = nextOccurrence(rule, current);
  }
  return dates;
}

/**
 * The absolute instant an occurrence becomes due: midnight, in the rule's
 * timezone, on that calendar date. Stored as `timestamptz` so the worker can
 * compare it against `now()` without ambiguity.
 */
export function occurrenceInstant(
  occurrenceDate: string,
  timezone: string,
): Date {
  const parsed = DateTime.fromISO(occurrenceDate, { zone: timezone }).startOf(
    "day",
  );
  if (!parsed.isValid) {
    throw new RecurrenceError(
      `Cannot resolve occurrence ${occurrenceDate} in timezone ${timezone}`,
    );
  }
  return parsed.toJSDate();
}

/** Today's calendar date in a timezone — what "due now" is measured against. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  const date = DateTime.fromJSDate(now).setZone(timezone);
  if (!date.isValid) {
    throw new RecurrenceError(`Unknown timezone "${timezone}"`);
  }
  return date.toISODate() as string;
}
