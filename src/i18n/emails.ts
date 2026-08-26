import { createTranslator } from "use-intl/core";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "./locales";

/**
 * Translator for outbound email.
 *
 * Deliberately not `getTranslations`: that resolves the locale from the
 * incoming request, and mail is also sent from the background worker, where
 * there is no request to read. This builds a translator from an explicit
 * locale instead, so the same template works from an action and from a job.
 *
 * The locale comes from the recipient's account when they have one, falling
 * back to whatever language they were using when they triggered the mail.
 *
 * `use-intl/core` rather than `next-intl`, for the same reason: next-intl's
 * root entry re-exports `NextIntlClientProvider`, so importing it drags React
 * in. A bundler drops that again, but the worker is plain Node running under
 * `--conditions=react-server`, where the provider is evaluated for real and
 * `createContext` is not a function. `createTranslator` is use-intl's to begin
 * with — next-intl only passes it through — and its `core` entry touches no
 * React at all.
 */
const CATALOGUES: Record<AppLocale, Record<string, unknown>> = { en, fr };

/** The locale a background translator will actually use. */
export function resolveLocale(locale: string | null | undefined): AppLocale {
  return isAppLocale(locale) ? locale : DEFAULT_LOCALE;
}

export function emailTranslator(locale: string | null | undefined) {
  const resolved = resolveLocale(locale);
  return createTranslator({
    locale: resolved,
    messages: CATALOGUES[resolved] as typeof en,
    namespace: "emails",
  });
}

/**
 * The same trick for push notifications, which are also written outside a
 * request: the worker renders them in the recipient's language, not in the
 * language of whoever caused the event.
 */
export function notificationTranslator(locale: string | null | undefined) {
  const resolved = resolveLocale(locale);
  return createTranslator({
    locale: resolved,
    messages: CATALOGUES[resolved] as typeof en,
    namespace: "notifications",
  });
}
