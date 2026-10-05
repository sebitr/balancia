import { DateTime } from "luxon";

/**
 * A calendar date as the domain carries it: `YYYY-MM-DD`, no time, no zone.
 *
 * The shape alone is not enough, and neither is `Date.parse`, which is what
 * used to stand here. V8 rolls `2025-02-30` over to the second of March and
 * answers with a timestamp, so the check passed; PostgreSQL's `date` does not
 * roll anything over, refused the insert, and the request answered 500. The
 * offline outbox retries a 5xx, so an entry saved with that date went round
 * the queue for ever instead of being shown to its author as something to fix.
 *
 * So a date is read back after it is parsed: luxon either refuses it outright
 * or hands back a day, and only a day that prints as the same ten characters
 * it was read from is one the calendar actually has. `2024-02-29` survives the
 * trip; `2025-02-30`, `2025-04-31` and `2025-13-01` do not.
 *
 * The years are bounded as well. `0000-01-01` is a real ISO date — year zero is
 * 1 BC — and PostgreSQL has no year zero at all; and past that, a year typed
 * as `0202` or `2205` is a slip of the finger, not a dinner. Nothing Balancia
 * records happened before 1900, and nothing it plans runs past 2999.
 */

export const MIN_CALENDAR_YEAR = 1900;
export const MAX_CALENDAR_YEAR = 2999;

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** A real day of the calendar, spelt `YYYY-MM-DD`. */
export function isCalendarDate(value: string): boolean {
  if (!SHAPE.test(value)) return false;
  const parsed = DateTime.fromISO(value, { zone: "utc" });
  return parsed.isValid && parsed.toISODate() === value;
}

/** Inside the years above. Only meaningful for a string `isCalendarDate` passed. */
export function isInCalendarRange(value: string): boolean {
  const year = Number(value.slice(0, 4));
  return year >= MIN_CALENDAR_YEAR && year <= MAX_CALENDAR_YEAR;
}

/** Both checks at once, for callers that answer every refusal the same way. */
export function isAcceptedCalendarDate(value: string): boolean {
  return isCalendarDate(value) && isInCalendarRange(value);
}

/**
 * A real day PostgreSQL can hold, whatever its year.
 *
 * For reading back rather than for accepting: a list cursor names a row that
 * is already stored, and an import from before the range above may have filed
 * one in 1850. Refusing that cursor would restart the list at the top every
 * time the reader scrolled past it.
 */
export function isStorableDate(value: string): boolean {
  return isCalendarDate(value) && !value.startsWith("0000");
}
