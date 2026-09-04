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
import {
  ACCENT_COOKIE_NAME,
  resolveAccent,
  type AccentColor,
} from "@/modules/profile/accent";
import {
  resolveSurfaces,
  SURFACE_COOKIE_NAMES,
  type SurfacePreferences,
} from "@/modules/profile/surface";

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

/**
 * Which accent this request paints with.
 *
 * Read here rather than in `modules/profile` because reading a cookie is a
 * request-context job, and the domain modules stay framework-free — the same
 * reason the notation above is resolved here and not in `auth/service`.
 *
 * From the cookie alone. The account column exists so the choice follows
 * somebody to a new device, and sign-in copies it into the cookie there — see
 * `applyStoredPreferences`. A database round trip in front of the root layout,
 * on every render, for a value that has not changed since the last one, would
 * be a poor trade for skipping that copy.
 *
 * An unknown value resolves to coral rather than reaching `--primary`: the
 * cookie is not HttpOnly, so anything at all can be in it.
 */
export async function resolveAccentColor(): Promise<AccentColor> {
  const cookieStore = await cookies();
  return resolveAccent(cookieStore.get(ACCENT_COOKIE_NAME)?.value);
}

/**
 * Which dark surface this request is lit with. A cookie only, like the
 * accent, and for the same reasons — with the difference that there is no
 * account column behind it at all.
 */
export async function resolveSurfacePreferences(): Promise<SurfacePreferences> {
  const cookieStore = await cookies();
  return resolveSurfaces({
    dark: cookieStore.get(SURFACE_COOKIE_NAMES.dark)?.value,
  });
}
