import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import type { StoredPreferences } from "@/modules/auth/service";
import { ACCENT_COOKIE_NAME, isAccentColor } from "@/modules/profile/accent";
import {
  DEFAULT_SURFACES,
  isContrastChoice,
  isDarkSurface,
  isLightSurface,
  SURFACE_COOKIE_NAMES,
  type SurfacePreferences,
} from "@/modules/profile/surface";
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
 * Writes the display cookies: language, the accent, and how dates and numbers
 * are written.
 *
 * Kept out of `actions.ts` on purpose: everything exported from a `"use server"`
 * module is callable by any client, and this is internal plumbing rather than
 * something the browser should be able to invoke directly.
 *
 * Deliberately not HttpOnly — the precached offline shell reads the language
 * one in the browser, and none of them is a secret. They share a lifetime for
 * the same reason: every one is a preference rather than a session detail.
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
 * Writes the accent.
 *
 * A cookie rather than local storage, unlike the theme: the accent has to be
 * on `<html>` in the server's own HTML or the first paint is coral and the
 * second one is not, and a colour that changes under the reader once per visit
 * is worse than one that takes a moment to follow them to a new device.
 *
 * `null` clears it, which is the coral default rather than a stored value —
 * the same way `auto` is the absence of a notation rather than a token.
 */
export async function writeAccentCookie(accent: string | null): Promise<void> {
  const cookieStore = await cookies();
  if (accent === null) {
    cookieStore.delete(ACCENT_COOKIE_NAME);
    return;
  }
  if (!isAccentColor(accent)) return;
  cookieStore.set(ACCENT_COOKIE_NAME, accent, displayCookieOptions());
}

/**
 * Writes the surface and contrast cookies — the ones given, only.
 *
 * Per device rather than per account, so there is no column behind these;
 * see `modules/profile/surface.ts`. A default clears its cookie rather than
 * recording one, the same way coral clears the accent: cream, plum and
 * "follow my system" are the absence of a choice.
 */
export async function writeSurfaceCookies(
  preferences: Partial<SurfacePreferences>,
): Promise<void> {
  const cookieStore = await cookies();
  const cookieOptions = displayCookieOptions();

  const write = (
    name: string,
    value: string | undefined,
    known: boolean,
    fallback: string,
  ) => {
    if (value === undefined || !known) return;
    if (value === fallback) cookieStore.delete(name);
    else cookieStore.set(name, value, cookieOptions);
  };

  write(
    SURFACE_COOKIE_NAMES.light,
    preferences.light,
    isLightSurface(preferences.light),
    DEFAULT_SURFACES.light,
  );
  write(
    SURFACE_COOKIE_NAMES.dark,
    preferences.dark,
    isDarkSurface(preferences.dark),
    DEFAULT_SURFACES.dark,
  );
  write(
    SURFACE_COOKIE_NAMES.contrast,
    preferences.contrast,
    isContrastChoice(preferences.contrast),
    DEFAULT_SURFACES.contrast,
  );
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
  if (preferences.accentColor !== null) {
    await writeAccentCookie(preferences.accentColor);
  }
  const chosen = {
    dateFormat: preferences.dateFormat,
    numberFormat: preferences.numberFormat,
  };
  if (chosen.dateFormat !== null || chosen.numberFormat !== null) {
    await writeFormatCookies(chosen, { onlyChosen: true });
  }
}
