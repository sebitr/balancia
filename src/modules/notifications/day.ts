import type { DaySection } from "@/components/notifications/grouping";

/**
 * Which of Today / Yesterday / Earlier an instant falls in.
 *
 * Decided on the server, where the reader's time zone is already resolved, and
 * sent down with the row. Left to the browser it would be computed against a
 * second clock in a second zone, and a list rendered at ten past midnight would
 * hydrate into a different set of headings than the one the server drew.
 *
 * "Yesterday" is the previous *calendar* day rather than twenty-four hours
 * ago. On the two nights a year a clock moves, those are not the same thing,
 * and the calendar is what the heading claims to be about.
 */

export type { DaySection };

/** The calendar date an instant falls on, as `2026-08-24`. */
function calendarDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** The day before a calendar date. Stepped in UTC, which never skips an hour. */
function dayBefore(day: string): string {
  const stepped = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000);
  return stepped.toISOString().slice(0, 10);
}

export function daySectionOf(
  createdAt: Date,
  now: Date,
  timeZone: string,
): DaySection {
  const today = calendarDay(now, timeZone);
  const day = calendarDay(createdAt, timeZone);
  if (day === today) return "today";
  if (day === dayBefore(today)) return "yesterday";
  return "earlier";
}
