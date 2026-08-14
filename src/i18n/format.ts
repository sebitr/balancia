import { type AppLocale, rankLanguageTags } from "./locales";

/**
 * How dates and numbers are written, and the preferences that shape them.
 *
 * Balancia ships two interface languages but is read in far more places than
 * that: someone reading English in Paris still expects 13/08/2026 and
 * 1 234,56. So the *language* of the interface and the *notation* of its dates
 * and numbers are two separate choices. This module owns the second one.
 *
 * Both preferences default to `auto`, which follows the reader without them
 * having to say anything: the interface language, refined with the region
 * their browser asked for (see `resolveFormatLocale`).
 *
 * This module is deliberately free of server-only imports — the settings form
 * previews these formats in the browser, and every screen renders them on both
 * sides of hydration.
 */

/**
 * Expense and settlement dates are stored as plain calendar days
 * ("2026-08-13") with no time and no zone — the day someone spent the money,
 * not an instant. Handing that string to `new Date()` parses it as UTC
 * midnight, which is then rendered in the configured zone; anywhere west of
 * Greenwich that lands on the previous day. Pinning both ends to UTC keeps the
 * day that is displayed the day that was recorded.
 */
export function parsePlainDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** The zone a plain calendar day must be read and written in. */
const PLAIN_DATE_ZONE = "UTC";

/**
 * Date notations offered.
 *
 * `auto` is the reader's own, with month names in their language. The other
 * three are all-numeric on purpose: someone who overrides the default is
 * asking for one unambiguous shape everywhere, and a numeric date carries no
 * language to disagree with the interface.
 */
export const DATE_FORMATS = ["auto", "dmy", "mdy", "ymd"] as const;

export type DateFormat = (typeof DATE_FORMATS)[number];

export const DEFAULT_DATE_FORMAT: DateFormat = "auto";

/**
 * Number notations offered, named after their group and decimal separators.
 *
 * `Intl.NumberFormat` takes no separators of its own — the notation comes from
 * the locale — so each choice names the locale that writes numbers that way.
 * That is a feature rather than a workaround: it also settles where a currency
 * symbol goes, which is part of the same notation ("€1,234.56" against
 * "1 234,56 €") and not something a reader should have to pick separately.
 */
export const NUMBER_FORMATS = [
  "auto",
  "comma-dot",
  "dot-comma",
  "space-comma",
] as const;

export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export const DEFAULT_NUMBER_FORMAT: NumberFormat = "auto";

const NUMBER_FORMAT_LOCALES: Record<Exclude<NumberFormat, "auto">, string> = {
  "comma-dot": "en-US",
  "dot-comma": "de-DE",
  "space-comma": "fr-FR",
};

/**
 * Read on every request, like the language cookie, and for the same reason:
 * the offline shell is a static page that has to read these in the browser,
 * and how somebody writes their dates is not a secret.
 */
export const DATE_FORMAT_COOKIE_NAME = "balancia_date_format";
export const NUMBER_FORMAT_COOKIE_NAME = "balancia_number_format";

export function isDateFormat(value: unknown): value is DateFormat {
  return (
    typeof value === "string" &&
    (DATE_FORMATS as readonly string[]).includes(value)
  );
}

export function isNumberFormat(value: unknown): value is NumberFormat {
  return (
    typeof value === "string" &&
    (NUMBER_FORMATS as readonly string[]).includes(value)
  );
}

/** A region subtag: two letters (`GB`) or the three digits of a UN M.49 area. */
const REGION_SUBTAG = /^([a-z]{2}|\d{3})$/;

/**
 * The locale Intl formats with when the reader has expressed no preference.
 *
 * The interface language always wins the *language* half — a French reader is
 * not shown "August" because their laptop is set to en-US. What the browser
 * contributes is the region, and only when it asked for the same language:
 * `en` + `Accept-Language: en-GB` gives `en-GB`, so British readers get
 * 13/08/2026 and Indian readers get 12,34,567.89 without touching a setting.
 * A disagreement (a French interface on an en-US browser) means the region
 * says nothing about how this person reads French, so it is ignored.
 */
export function resolveFormatLocale(
  locale: AppLocale,
  acceptLanguage: string | null | undefined,
): string {
  for (const tag of rankLanguageTags(acceptLanguage)) {
    const [language, ...rest] = tag.split("-");
    if (language !== locale) continue;
    const region = rest.find((subtag) => REGION_SUBTAG.test(subtag));
    if (region) return `${locale}-${region.toUpperCase()}`;
  }
  return locale;
}

/** The locale `Intl.NumberFormat` should be handed for a given preference. */
export function numberLocale(
  format: NumberFormat,
  formatLocale: string,
): string {
  return format === "auto" ? formatLocale : NUMBER_FORMAT_LOCALES[format];
}

/**
 * How much of a date is being shown.
 *
 * `medium` is the everyday one; `long` is for the roomier places (a tooltip
 * spelling out what a relative time means); `dayMonth` drops the year where
 * the surrounding text already established it. The three differ only under
 * `auto` — an explicit notation is one shape by definition, which is what the
 * reader chose it for.
 */
export type DateStyle = "medium" | "long" | "dayMonth";

const AUTO_STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  medium: { dateStyle: "medium" },
  long: { dateStyle: "long" },
  dayMonth: { day: "numeric", month: "short" },
};

/** The calendar fields of an instant in a given zone, zero-padded. */
function calendarFields(
  date: Date,
  timeZone: string,
): { year: string; month: string; day: string } {
  // A fixed locale, since only the digits are read back — never the order the
  // locale would have put them in, which is what the preference decides.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
  };
}

function formatExplicit(
  date: Date,
  format: Exclude<DateFormat, "auto">,
  timeZone: string,
  style: DateStyle,
): string {
  const { year, month, day } = calendarFields(date, timeZone);
  if (style === "dayMonth") {
    switch (format) {
      case "dmy":
        return `${day}/${month}`;
      case "mdy":
        return `${month}/${day}`;
      case "ymd":
        return `${month}-${day}`;
    }
  }
  switch (format) {
    case "dmy":
      return `${day}/${month}/${year}`;
    case "mdy":
      return `${month}/${day}/${year}`;
    case "ymd":
      return `${year}-${month}-${day}`;
  }
}

export interface DateFormatOptions {
  /** The reader's choice. */
  readonly dateFormat: DateFormat;
  /** Only consulted for `auto`; supplies the language of month names. */
  readonly locale: string;
  readonly timeZone: string;
  readonly style?: DateStyle;
  /** Append the clock, for the few places that record a moment rather than a day. */
  readonly time?: "short";
}

export function formatDate(date: Date, options: DateFormatOptions): string {
  const { dateFormat, locale, timeZone, style = "medium", time } = options;
  if (dateFormat === "auto") {
    return new Intl.DateTimeFormat(locale, {
      ...AUTO_STYLES[style],
      ...(time ? { timeStyle: time } : {}),
      timeZone,
    }).format(date);
  }
  const day = formatExplicit(date, dateFormat, timeZone, style);
  if (!time) return day;
  // The locale still writes the clock — a 12- or 24-hour day is not something
  // the date notation decides.
  const clock = new Intl.DateTimeFormat(locale, {
    timeStyle: time,
    timeZone,
  }).format(date);
  return `${day}, ${clock}`;
}

/**
 * The two ways a screen asks for a date, bound to one reader's preference.
 *
 * `plain` and `at` exist separately because the two kinds of date are not the
 * same thing: a stored calendar day has no zone and must not be given one,
 * while an instant has to be resolved to the day it fell on somewhere.
 */
export interface DateFormatter {
  /** A stored calendar day, e.g. `"2026-08-13"`. Never carries a time. */
  plain(value: string, style?: DateStyle): string;
  /** The day an instant falls on, in the app's zone. */
  at(
    value: Date | string | number,
    options?: { style?: DateStyle; time?: "short" },
  ): string;
}

export function createDateFormatter(preferences: {
  dateFormat: DateFormat;
  formatLocale: string;
  timeZone: string;
}): DateFormatter {
  const { dateFormat, formatLocale, timeZone } = preferences;
  return {
    plain: (value, style) =>
      formatDate(parsePlainDate(value), {
        dateFormat,
        locale: formatLocale,
        timeZone: PLAIN_DATE_ZONE,
        style,
      }),
    at: (value, options = {}) =>
      formatDate(value instanceof Date ? value : new Date(value), {
        dateFormat,
        locale: formatLocale,
        timeZone,
        style: options.style,
        time: options.time,
      }),
  };
}

/**
 * The 13th of a month past the 12th, so `dmy` and `mdy` cannot be mistaken for
 * one another in the settings preview.
 */
export const SAMPLE_DATE = "2026-08-13";

/** Big enough to show grouping, precise enough to show the decimal mark. */
export const SAMPLE_NUMBER = 1234567.89;

/** What a date choice looks like, for the reader deciding between them. */
export function dateFormatSample(
  format: DateFormat,
  formatLocale: string,
): string {
  return formatDate(parsePlainDate(SAMPLE_DATE), {
    dateFormat: format,
    locale: formatLocale,
    timeZone: PLAIN_DATE_ZONE,
  });
}

/** Likewise for numbers. */
export function numberFormatSample(
  format: NumberFormat,
  formatLocale: string,
): string {
  return new Intl.NumberFormat(numberLocale(format, formatLocale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(SAMPLE_NUMBER);
}
