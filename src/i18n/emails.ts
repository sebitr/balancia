import { createTranslator } from "next-intl";
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
 */
const CATALOGUES: Record<AppLocale, Record<string, unknown>> = { en, fr };

export function emailTranslator(locale: string | null | undefined) {
  const resolved: AppLocale = isAppLocale(locale) ? locale : DEFAULT_LOCALE;
  return createTranslator({
    locale: resolved,
    messages: CATALOGUES[resolved] as typeof en,
    namespace: "emails",
  });
}
