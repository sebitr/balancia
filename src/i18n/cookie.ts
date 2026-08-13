import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import {
  isAppLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "./locales";

/**
 * Writes the language cookie.
 *
 * Kept out of `actions.ts` on purpose: everything exported from a `"use server"`
 * module is callable by any client, and this is internal plumbing rather than
 * something the browser should be able to invoke directly.
 *
 * Deliberately not HttpOnly — the precached offline shell has to read it in the
 * browser, and a language preference is not a secret.
 */
export async function writeLocaleCookie(locale: string): Promise<void> {
  if (!isAppLocale(locale)) return;
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale, {
    httpOnly: false,
    sameSite: "lax",
    secure: getEnv().appOrigin.startsWith("https://"),
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
  });
}

/**
 * Seeds the cookie from an account's stored preference at sign-in.
 *
 * Does nothing when the account has no stored language, leaving the existing
 * cookie or `Accept-Language` negotiation in charge.
 */
export async function applyStoredLocale(locale: string | null): Promise<void> {
  if (!locale) return;
  await writeLocaleCookie(locale);
}
