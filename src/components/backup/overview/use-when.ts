"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useDateFormatter, useFormatPreferences } from "@/i18n/format-context";

/**
 * How the backup screens say when something happened, or will.
 *
 * "Today, 3:30 PM" and "Yesterday, 3:30 PM" for the two days a person still
 * remembers, "Just now" for the last couple of minutes, and the reader's own
 * date notation (`useDateFormatter`) with the clock for anything older. The
 * day a moment falls on is the app's zone's, the same one `dates.at` uses, so
 * "today" here and a date written there never disagree.
 *
 * `now` comes from the server render and is passed down, never read from the
 * clock here: two clocks, one on each side of hydration, are how a string comes
 * to disagree with itself (see `dashboard/relative-time.tsx`).
 */

/** A backup that finished this recently is "just now", not a time of day. */
const JUST_NOW_MS = 2 * 60 * 1000;

/** `YYYY-MM-DD` moved by a number of days, as plain calendar arithmetic. */
function shiftDay(key: string, days: number): string {
  const [year = 0, month = 1, day = 1] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export interface When {
  /** A moment in the past: "Just now", "Today, 3:30 PM", "Oct 7, 2026, 3:30 PM". */
  readonly past: (value: Date | string) => string;
  /** A moment ahead: "Tomorrow, around 3:30 PM", or the date when it is further off. */
  readonly ahead: (value: Date | string) => string;
}

export function useWhen(now: string): When {
  const t = useTranslations("cloudBackup");
  const dates = useDateFormatter();
  const { formatLocale, timeZone } = useFormatPreferences();

  const clock = useMemo(
    () =>
      new Intl.DateTimeFormat(formatLocale, {
        timeStyle: "short",
        timeZone,
      }),
    [formatLocale, timeZone],
  );

  return useMemo(() => {
    // A fixed locale, because only the digits are read back to tell days apart.
    const dayOf = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const nowDate = new Date(now);
    const today = dayOf.format(nowDate);
    const yesterday = shiftDay(today, -1);
    const tomorrow = shiftDay(today, 1);

    const asDate = (value: Date | string) =>
      value instanceof Date ? value : new Date(value);

    return {
      past: (value) => {
        const date = asDate(value);
        const age = nowDate.getTime() - date.getTime();
        if (age >= 0 && age < JUST_NOW_MS) return t("overview.justNow");
        const day = dayOf.format(date);
        if (day === today) {
          return t("overview.today", { time: clock.format(date) });
        }
        if (day === yesterday) {
          return t("overview.yesterday", { time: clock.format(date) });
        }
        return dates.at(date, { time: "short" });
      },
      ahead: (value) => {
        const date = asDate(value);
        const day = dayOf.format(date);
        if (day === tomorrow) {
          return t("overview.nextValue", { time: clock.format(date) });
        }
        if (day === today) {
          return t("overview.today", { time: clock.format(date) });
        }
        return dates.at(date, { time: "short" });
      },
    };
  }, [clock, dates, now, t, timeZone]);
}

/** Hours until a retry, never less than one: "about 0 hours" is not a plan. */
export function hoursUntil(value: Date, now: string): number {
  const ms = value.getTime() - new Date(now).getTime();
  return Math.max(1, Math.round(ms / (60 * 60 * 1000)));
}
