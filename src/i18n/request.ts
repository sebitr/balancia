import { cookies, headers } from "next/headers";
import type { Messages } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import {
  isAppLocale,
  LOCALE_COOKIE_NAME,
  LOCALE_HEADER_NAME,
  negotiateLocale,
  type AppLocale,
} from "./locales";

/**
 * Per-request i18n configuration, read by `next-intl` on every render.
 *
 * On a public page the address decides. Everywhere else the order is cookie,
 * then `Accept-Language`, then English. The cookie is written by the language
 * switcher and also refreshed at sign-in from the account's stored preference,
 * so a returning user gets their language on a new device without this
 * needing a database round trip.
 */

const MESSAGE_LOADERS: Record<AppLocale, () => Promise<{ default: unknown }>> =
  {
    en: () => import("../../messages/en.json"),
    fr: () => import("../../messages/fr.json"),
  };

/**
 * A whole catalogue, for the server. The offline screen reads every language
 * through this at build time, because it cannot ask which one it will need.
 */
export async function loadMessages(locale: AppLocale): Promise<Messages> {
  // Typed against English, which `messages.test.ts` keeps every other
  // catalogue in step with.
  return (await MESSAGE_LOADERS[locale]()).default as Messages;
}

export async function resolveRequestLocale(): Promise<AppLocale> {
  // A public page's language is its address. `proxy.ts` writes this header
  // for those pages and strips it from every other request, so reading it
  // first cannot hand a client the choice of any other screen's language.
  const addressed = (await headers()).get(LOCALE_HEADER_NAME);
  if (isAppLocale(addressed)) return addressed;

  return resolvePreferredLocale();
}

/**
 * The language this reader would choose, whatever the address says: their
 * cookie, then their browser's `Accept-Language`, then English.
 *
 * Everything outside the public pages is rendered in it. The homepage asks
 * separately, to send a French reader who opened `/` on to `/fr`.
 */
export async function resolvePreferredLocale(): Promise<AppLocale> {
  const cookieStore = await cookies();
  const stored = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (isAppLocale(stored)) return stored;

  const requestHeaders = await headers();
  return negotiateLocale(requestHeaders.get("accept-language"));
}

export default getRequestConfig(async ({ locale: asked }) => {
  // A caller may name the language it wants — `getTranslations({ locale })` —
  // and `/llms-full.txt` does: it is written in English whoever fetches it.
  // Without this the name was accepted and ignored, and the answer came back
  // in the request's language under the asked-for one's label.
  const locale = isAppLocale(asked) ? asked : await resolveRequestLocale();

  return {
    locale,
    messages: await loadMessages(locale),
    // Pinned so a date renders identically on the server and after hydration.
    // Group-scoped time zones are applied where a date is tied to a group.
    timeZone: process.env.TZ ?? "UTC",
  };
});
