import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  isAppLocale,
  LOCALE_COOKIE_NAME,
  negotiateLocale,
  type AppLocale,
} from "./locales";

/**
 * Per-request i18n configuration, read by `next-intl` on every render.
 *
 * Resolution order is cookie, then `Accept-Language`, then English. The
 * cookie is written by the language switcher and also refreshed at sign-in
 * from the account's stored preference, so a returning user gets their
 * language on a new device without this needing a database round trip.
 */

const MESSAGE_LOADERS: Record<AppLocale, () => Promise<{ default: unknown }>> =
  {
    en: () => import("../../messages/en.json"),
    fr: () => import("../../messages/fr.json"),
  };

export async function resolveRequestLocale(): Promise<AppLocale> {
  const cookieStore = await cookies();
  const stored = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (isAppLocale(stored)) return stored;

  const requestHeaders = await headers();
  return negotiateLocale(requestHeaders.get("accept-language"));
}

export default getRequestConfig(async () => {
  const locale = await resolveRequestLocale();
  const messages = (await MESSAGE_LOADERS[locale]()).default;

  return {
    locale,
    messages: messages as Record<string, unknown>,
    // Pinned so a date renders identically on the server and after hydration.
    // Group-scoped time zones are applied where a date is tied to a group.
    timeZone: process.env.TZ ?? "UTC",
  };
});
