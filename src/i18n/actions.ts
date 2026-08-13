"use server";

import { getCurrentUser } from "@/lib/security/actor";
import { saveUserLocale } from "@/modules/auth/service";
import { writeLocaleCookie } from "./cookie";
import { isAppLocale } from "./locales";

/**
 * Records the reader's language choice.
 *
 * The cookie is what every subsequent request reads (see `request.ts`). For a
 * signed-in user the choice is also written to their account, so a new browser
 * starts in the right language before they touch the switcher — sign-in seeds
 * the cookie from that stored value.
 *
 * Not HttpOnly: the offline shell is a static page that has to read this from
 * the browser, and a language preference is not a secret.
 */
export async function setLocaleAction(locale: string): Promise<void> {
  if (!isAppLocale(locale)) return;

  await writeLocaleCookie(locale);

  const user = await getCurrentUser();
  if (user) {
    await saveUserLocale(user.userId, locale);
  }
}
