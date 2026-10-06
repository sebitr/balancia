import type {
  RecurrenceFrequency,
  WeekOfMonth,
} from "@/modules/recurring/schedule";

/**
 * A schedule in words, said one way wherever one is shown.
 *
 * The same rule used to read three ways on three screens: "Every month on the
 * 5" in the repeat sheet, "Monthly, Day 5" on the entry form's row, and "Every
 * month on day 5" in the Recurring list — and the form's row read a weekly
 * rule as "Weekly, 1", the number of its weekday. A reader checking that what
 * they set up is what was saved had three sentences to reconcile. Now there is
 * one family, `recurring.schedule`, and this decides which of its sentences a
 * rule is and what goes in it; the sheet, the form's row and the list all ask
 * here.
 *
 * Whole sentences, one per kind of rule, with the interval as a plural and the
 * day of the month as an ordinal — "Every month on the 1st", "Tous les mois,
 * le 1er" — so no language has to assemble one from fragments. The names it
 * needs (a weekday, "second", a day and month) are the caller's to supply, in
 * the reader's language and date notation, which keeps this a plain function
 * a server page and a client sheet can share.
 */

/** As much of a rule as its sentence needs. */
export interface ScheduleShape {
  readonly frequency: RecurrenceFrequency;
  readonly interval: number;
  /** ISO, 1 = Monday. */
  readonly weekday: number | null;
  readonly weekOfMonth: WeekOfMonth | null;
  readonly dayOfMonth: number | null;
  readonly monthOfYear: number | null;
  /**
   * The day the rule runs from. A yearly rule the entry form saved carries no
   * month of its own — it falls in the month it started in — and a rule with
   * no day falls on the day it started on, as the scheduler reads them.
   */
  readonly startDate: string;
}

/** The words a sentence is built from, in the reader's language. */
export interface ScheduleNames {
  /** The locale's name for an ISO weekday. */
  readonly weekday: (isoWeekday: number) => string;
  /** "second", "last": which week of the month. */
  readonly week: (week: WeekOfMonth) => string;
  /** A calendar day with no year, as the reader writes dates. */
  readonly dayMonth: (isoDate: string) => string;
}

export type ScheduleKey =
  "daily" | "weekly" | "monthly" | "monthlyWeekday" | "yearly";

export interface ScheduleSentence {
  /** A key under `recurring.schedule`. */
  readonly key: ScheduleKey;
  readonly values: Record<string, string | number>;
}

export function scheduleSentence(
  shape: ScheduleShape,
  names: ScheduleNames,
): ScheduleSentence {
  const count = shape.interval;
  const start = {
    month: Number(shape.startDate.slice(5, 7)),
    day: Number(shape.startDate.slice(8, 10)),
  };

  switch (shape.frequency) {
    case "daily":
      return { key: "daily", values: { count } };
    case "weekly":
      return {
        key: "weekly",
        values: {
          count,
          weekday: names.weekday(
            shape.weekday ?? isoWeekdayOf(shape.startDate),
          ),
        },
      };
    case "monthly":
      if (shape.weekOfMonth !== null) {
        return {
          key: "monthlyWeekday",
          values: {
            count,
            week: names.week(shape.weekOfMonth),
            weekday: names.weekday(shape.weekday ?? 1),
          },
        };
      }
      return {
        key: "monthly",
        values: { count, day: shape.dayOfMonth ?? start.day },
      };
    case "yearly": {
      const month = shape.monthOfYear ?? start.month;
      // A leap year, so the 29th of February is a day it can name; and the
      // 31st of a shorter month reads as its last day, which is where the
      // scheduler puts it.
      const day = Math.min(
        shape.dayOfMonth ?? start.day,
        new Date(Date.UTC(2024, month, 0)).getUTCDate(),
      );
      return {
        key: "yearly",
        values: { count, date: names.dayMonth(isoDay(2024, month, day)) },
      };
    }
  }
}

/** The ISO weekday of a calendar date, 1 = Monday. */
function isoWeekdayOf(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The locale's own name for an ISO weekday, from `Intl` rather than the
 * catalogue: weekday names are data every runtime already ships. 2024-01-01
 * was a Monday, which lines the offsets up with ISO numbering.
 */
export function weekdayName(locale: string, isoWeekday: number): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2024, 0, isoWeekday)));
}
