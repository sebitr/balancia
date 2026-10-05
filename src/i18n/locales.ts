/**
 * The locales Balancia ships with, and how one is chosen for a request.
 *
 * This module is deliberately free of server-only imports: the locale list and
 * the type guard are needed by the language switcher in the browser as well as
 * by request handling on the server.
 *
 * Inside the app, locale is resolved from a cookie rather than a URL prefix:
 * those screens are private and authenticated, so per-language URLs would buy
 * nothing there and would break existing invitation links.
 *
 * The public pages are the exception, and for them the address is the
 * language — `/` is English, `/fr` is French. A crawler sends no cookie and no
 * `Accept-Language`, so while the homepage picked its language from those it
 * was only ever read in English, and the French copy was in no index at all.
 * `src/lib/public-pages.ts` holds the addresses and `proxy.ts` turns one into
 * the header below.
 */

export const LOCALES = ["en", "fr"] as const;

export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

export const LOCALE_COOKIE_NAME = "balancia_locale";

/**
 * The language a public page was addressed in, from `proxy.ts` to the render.
 *
 * A request header rather than a route parameter because the root layout
 * writes `<html lang>` and hands the browser its messages, and a layout is
 * told nothing about the segments beneath it. `proxy.ts` sets this on a public
 * page and removes it from every other request, so it is never the client's
 * to send.
 */
export const LOCALE_HEADER_NAME = "x-balancia-locale";

/** A year: the choice is a preference, not a session detail. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Each language named in itself — a French speaker looking for their language
 * scans for "Français", not "French".
 */
export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: "English",
  fr: "Français",
};

export function isAppLocale(value: unknown): value is AppLocale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

/**
 * The tags an `Accept-Language` header asks for, best first.
 *
 * Hand-rolled rather than pulling in a negotiation library: the entire problem
 * is "sort by q". Tags are lowercased; `q=0` is an explicit refusal rather
 * than a weak preference, so those are dropped.
 */
export function rankLanguageTags(
  acceptLanguage: string | null | undefined,
): string[] {
  if (!acceptLanguage) return [];

  return acceptLanguage
    .split(",")
    .map((part) => {
      const [rawTag, ...params] = part.trim().split(";");
      const quality = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));
      const parsed = quality ? Number.parseFloat(quality.slice(2)) : 1;
      return {
        tag: rawTag?.trim().toLowerCase() ?? "",
        quality: Number.isFinite(parsed) ? parsed : 0,
      };
    })
    .filter((entry) => entry.tag !== "" && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality)
    .map((entry) => entry.tag);
}

/**
 * Picks the best supported locale from an `Accept-Language` header.
 *
 * A tag is matched both in full (`fr-CA`) and by its primary subtag (`fr`), so
 * a regional variant still finds the base language.
 */
export function negotiateLocale(
  acceptLanguage: string | null | undefined,
): AppLocale {
  for (const tag of rankLanguageTags(acceptLanguage)) {
    if (tag === "*") return DEFAULT_LOCALE;
    const primary = tag.split("-")[0];
    const match = LOCALES.find(
      (locale) => locale === tag || locale === primary,
    );
    if (match) return match;
  }

  return DEFAULT_LOCALE;
}
