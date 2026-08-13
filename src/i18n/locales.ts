/**
 * The locales Balancia ships with, and how one is chosen for a request.
 *
 * This module is deliberately free of server-only imports: the locale list and
 * the type guard are needed by the language switcher in the browser as well as
 * by request handling on the server.
 *
 * Locale is resolved from a cookie rather than a URL prefix. Balancia is a
 * private, authenticated app with no SEO surface, so per-language URLs would
 * buy nothing and would break existing invitation links.
 */

export const LOCALES = ["en", "fr"] as const;

export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

export const LOCALE_COOKIE_NAME = "balancia_locale";

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
 * Picks the best supported locale from an `Accept-Language` header.
 *
 * Hand-rolled rather than pulling in a negotiation library: with two locales
 * the entire problem is "sort by q, match on the primary subtag". A tag is
 * matched both in full (`fr-CA`) and by its primary subtag (`fr`), so a
 * regional variant still finds the base language.
 */
export function negotiateLocale(
  acceptLanguage: string | null | undefined,
): AppLocale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const ranked = acceptLanguage
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
    // q=0 is an explicit refusal, not a weak preference.
    .filter((entry) => entry.tag !== "" && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    if (tag === "*") return DEFAULT_LOCALE;
    const primary = tag.split("-")[0];
    const match = LOCALES.find(
      (locale) => locale === tag || locale === primary,
    );
    if (match) return match;
  }

  return DEFAULT_LOCALE;
}
