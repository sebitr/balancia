"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  createDateFormatter,
  DEFAULT_DATE_FORMAT,
  DEFAULT_NUMBER_FORMAT,
  numberLocale,
  type DateFormat,
  type DateFormatter,
  type NumberFormat,
} from "./format";

/**
 * How dates and numbers are written, carried to Client Components.
 *
 * Resolved once per request on the server (see `preferences.ts`) and handed
 * down rather than re-derived in the browser: the reader's own `navigator`
 * settings are deliberately not consulted here, because a value the server did
 * not use would render a different date on hydration than the one already on
 * screen.
 *
 * Shaped after `NextIntlClientProvider`, which supplies the language the same
 * way — one provider at the root, no prop drilling below it.
 */

interface FormatContextValue {
  readonly dateFormat: DateFormat;
  readonly numberFormat: NumberFormat;
  readonly formatLocale: string;
  readonly timeZone: string;
}

const FALLBACK: FormatContextValue = {
  dateFormat: DEFAULT_DATE_FORMAT,
  numberFormat: DEFAULT_NUMBER_FORMAT,
  formatLocale: "en",
  timeZone: "UTC",
};

const FormatContext = createContext<FormatContextValue | null>(null);

export function FormatPreferencesProvider({
  value,
  children,
}: {
  value: FormatContextValue;
  children: ReactNode;
}) {
  const stable = useMemo(
    () => ({
      dateFormat: value.dateFormat,
      numberFormat: value.numberFormat,
      formatLocale: value.formatLocale,
      timeZone: value.timeZone,
    }),
    [value.dateFormat, value.numberFormat, value.formatLocale, value.timeZone],
  );
  return (
    <FormatContext.Provider value={stable}>{children}</FormatContext.Provider>
  );
}

/**
 * Falls back to the defaults rather than throwing when there is no provider:
 * a component test that renders one card in isolation should show dates, not
 * an error, and the defaults are exactly what an unconfigured reader gets.
 */
function useFormatContext(): FormatContextValue {
  return useContext(FormatContext) ?? FALLBACK;
}

/** The reader's date formatter. See `DateFormatter` for the two entry points. */
export function useDateFormatter(): DateFormatter {
  const { dateFormat, formatLocale, timeZone } = useFormatContext();
  return useMemo(
    () => createDateFormatter({ dateFormat, formatLocale, timeZone }),
    [dateFormat, formatLocale, timeZone],
  );
}

/**
 * The locale to format money and other numbers with — which is not always the
 * interface language, since notation is chosen separately from it.
 */
export function useNumberLocale(): string {
  const { numberFormat, formatLocale } = useFormatContext();
  return numberLocale(numberFormat, formatLocale);
}

/** The raw choices, for the settings form that edits them. */
export function useFormatPreferences(): FormatContextValue {
  return useFormatContext();
}
