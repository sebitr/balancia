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

export type RecurrenceFrequency = "weekly" | "monthly" | "yearly";

export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency;
  /** Every N periods; 2 + weekly = fortnightly. */
  readonly interval: number;
  /** ISO weekday 1 (Monday) – 7 (Sunday). Weekly only. */
  readonly weekday?: number | null;
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
  if (rule.frequency === "weekly") {
    if (rule.weekday != null && (rule.weekday < 1 || rule.weekday > 7)) {
      throw new RecurrenceError(
        "Weekday must be between 1 (Monday) and 7 (Sunday)",
      );
    }
  }
  if (
    rule.dayOfMonth != null &&
    (rule.dayOfMonth < 1 || rule.dayOfMonth > 31)
  ) {
    throw new RecurrenceError("Day of month must be between 1 and 31");
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
 * The first occurrence on or after `startDate`, aligned to the rule's weekday
 * or day-of-month.
 */
export function firstOccurrence(rule: RecurrenceRule): string | null {
  validateRule(rule);
  const start = parseDate(rule.startDate, rule.timezone);

  let candidate: DateTime;
  switch (rule.frequency) {
    case "weekly": {
      const targetWeekday = rule.weekday ?? start.weekday;
      const delta = (targetWeekday - start.weekday + 7) % 7;
      candidate = start.plus({ days: delta });
      break;
    }
    case "monthly": {
      const targetDay = rule.dayOfMonth ?? start.day;
      candidate = withDayOfMonth(start, targetDay);
      if (candidate < start) {
        candidate = withDayOfMonth(start.plus({ months: 1 }), targetDay);
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
    case "weekly":
      candidate = previousDate.plus({ weeks: rule.interval });
      break;
    case "monthly": {
      const targetDay = rule.dayOfMonth ?? previousDate.day;
      // Step from the first of the month so a clamped 31st does not drag the
      // schedule backwards (Jan 31 → Feb 28 → Mar 28 would be wrong).
      const base = previousDate
        .startOf("month")
        .plus({ months: rule.interval });
      candidate = withDayOfMonth(base, targetDay);
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
  options: { from?: string | null; maxOccurrences?: number } = {},
): string[] {
  validateRule(rule);
  const limit = options.maxOccurrences ?? 500;
  const untilDate = parseDate(until, rule.timezone);

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
