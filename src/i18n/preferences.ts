import "server-only";
import { cookies, headers } from "next/headers";
import { getTimeZone } from "next-intl/server";
import {
  createDateFormatter,
  DATE_FORMAT_COOKIE_NAME,
  DEFAULT_DATE_FORMAT,
  DEFAULT_NUMBER_FORMAT,
  isDateFormat,
  isNumberFormat,
  numberLocale,
  NUMBER_FORMAT_COOKIE_NAME,
  resolveFormatLocale,
  type DateFormat,
  type DateFormatter,
  type NumberFormat,
} from "./format";
import { resolveRequestLocale } from "./request";

/**
 * Per-request resolution of how this reader writes dates and numbers.
 *
 * Resolution mirrors the language: cookie first, then the request headers.
 * The cookie is written by the settings form and refreshed at sign-in from the
 * account's stored preference, so a returning user's notation follows them to
 * a new device without this needing a database round trip.
 */

export interface FormatPreferences {
  readonly dateFormat: DateFormat;
  readonly numberFormat: NumberFormat;
  /** The locale Intl formats with when a preference is left on `auto`. */
  readonly formatLocale: string;
  /** Ready to hand to `Intl.NumberFormat` and `formatMoney`. */
  readonly numberLocale: string;
  /** Where an instant is resolved to a calendar day. */
  readonly timeZone: string;
}

export async function resolveFormatPreferences(): Promise<FormatPreferences> {
  const [cookieStore, requestHeaders, locale, timeZone] = await Promise.all([
    cookies(),
    headers(),
    resolveRequestLocale(),
    getTimeZone(),
  ]);

  const storedDate = cookieStore.get(DATE_FORMAT_COOKIE_NAME)?.value;
  const storedNumber = cookieStore.get(NUMBER_FORMAT_COOKIE_NAME)?.value;
  const dateFormat = isDateFormat(storedDate)
    ? storedDate
    : DEFAULT_DATE_FORMAT;
  const numberFormat = isNumberFormat(storedNumber)
    ? storedNumber
    : DEFAULT_NUMBER_FORMAT;
  const formatLocale = resolveFormatLocale(
    locale,
    requestHeaders.get("accept-language"),
  );

  return {
    dateFormat,
    numberFormat,
    formatLocale,
    numberLocale: numberLocale(numberFormat, formatLocale),
    timeZone,
  };
}

/**
 * The date formatter for Server Components — the counterpart of
 * `useDateFormatter` on the other side of the tree.
 */
export async function getDateFormatter(): Promise<DateFormatter> {
  return createDateFormatter(await resolveFormatPreferences());
}

/** The locale a Server Component should format money and numbers with. */
export async function getNumberLocale(): Promise<string> {
  return (await resolveFormatPreferences()).numberLocale;
}
