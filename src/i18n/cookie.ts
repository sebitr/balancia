import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import type { StoredPreferences } from "@/modules/auth/service";
import {
  DATE_FORMAT_COOKIE_NAME,
  isDateFormat,
  isNumberFormat,
  NUMBER_FORMAT_COOKIE_NAME,
} from "./format";
import {
  isAppLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "./locales";

/**
 * Writes the display cookies: language, and how dates and numbers are written.
 *
 * Kept out of `actions.ts` on purpose: everything exported from a `"use server"`
 * module is callable by any client, and this is internal plumbing rather than
 * something the browser should be able to invoke directly.
 *
 * Deliberately not HttpOnly — the precached offline shell reads the language
 * one in the browser, and none of them is a secret. They share a lifetime for
 * the same reason: all three are preferences rather than session details.
 */
function displayCookieOptions() {
  return {
    httpOnly: false,
    sameSite: "lax",
    secure: getEnv().appOrigin.startsWith("https://"),
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
  } as const;
}

export async function writeLocaleCookie(locale: string): Promise<void> {
  if (!isAppLocale(locale)) return;
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale, displayCookieOptions());
}

/**
 * Writes the notation cookies.
 *
 * `null` means "follow my locale", which is the absence of a choice rather
 * than a value — so it deletes the cookie instead of recording a token,
 * leaving `resolveFormatPreferences` to fall back the way it does for a reader
 * who has never chosen. `onlyChosen` suppresses that deletion, for the seeding
 * case where silence means "no opinion" rather than "clear this".
 */
export async function writeFormatCookies(
  preferences: {
    dateFormat: string | null;
    numberFormat: string | null;
  },
  options: { onlyChosen?: boolean } = {},
): Promise<void> {
  const cookieStore = await cookies();
  const cookieOptions = displayCookieOptions();

  const write = (name: string, value: string | null, known: boolean) => {
    if (value === null) {
      if (!options.onlyChosen) cookieStore.delete(name);
    } else if (known) {
      cookieStore.set(name, value, cookieOptions);
    }
  };

  write(
    DATE_FORMAT_COOKIE_NAME,
    preferences.dateFormat,
    isDateFormat(preferences.dateFormat),
  );
  write(
    NUMBER_FORMAT_COOKIE_NAME,
    preferences.numberFormat,
    isNumberFormat(preferences.numberFormat),
  );
}

/**
 * Seeds the cookies from an account's stored preferences at sign-in.
 *
 * A field the account never chose leaves the existing cookie alone rather than
 * clearing it: the person may have set a notation on this device before
 * signing in, and their account being silent on the matter is not a reason to
 * take it away.
 */
export async function applyStoredPreferences(
  preferences: StoredPreferences,
): Promise<void> {
  if (preferences.locale) {
    await writeLocaleCookie(preferences.locale);
  }
  const chosen = {
    dateFormat: preferences.dateFormat,
    numberFormat: preferences.numberFormat,
  };
  if (chosen.dateFormat !== null || chosen.numberFormat !== null) {
    await writeFormatCookies(chosen, { onlyChosen: true });
  }
}
