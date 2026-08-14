"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { actionError, runAction, type ActionResult } from "@/lib/actions";
import { getCurrentUser } from "@/lib/security/actor";
import {
  saveUserFormatPreferences,
  saveUserPreferredCurrency,
} from "@/modules/auth/service";
import { isSupportedCurrency } from "@/modules/currencies/iso-4217";
import { writeFormatCookies } from "@/i18n/cookie";
import { isDateFormat, isNumberFormat } from "@/i18n/format";

/**
 * Account preferences that are not authentication.
 *
 * The currency here is a display choice and nothing else: it decides what the
 * home screen totals in, and never touches a stored amount or a frozen rate.
 */
export async function setPreferredCurrencyAction(
  currency: string,
): Promise<ActionResult> {
  const t = await getTranslations("serverErrors");

  const user = await getCurrentUser();
  if (!user) return actionError(t("signedInRequired"));

  // Empty clears the choice; anything else has to be a currency we know.
  const value = currency.trim().toUpperCase();
  if (value !== "" && !isSupportedCurrency(value)) {
    return actionError(t("unknownCurrency"));
  }

  return runAction("setPreferredCurrency", async () => {
    await saveUserPreferredCurrency(user.userId, value === "" ? null : value);
    revalidatePath("/dashboard");
  });
}

/**
 * How this reader writes dates and numbers.
 *
 * The cookie is what every subsequent render reads, exactly as it is for the
 * language; the account copy is what carries the choice to their next device.
 * `"auto"` is stored as the absence of a choice, so a reader who moves country
 * — or changes their browser's region — is followed by their new default
 * rather than pinned to the old one.
 *
 * Unlike the language, this is offered to signed-out readers too: the sign-in
 * page shows no dates, but the cookie survives into the session, and refusing
 * to remember a display preference until someone has an account would be
 * gratuitous.
 */
export async function setFormatPreferencesAction(input: {
  dateFormat: string;
  numberFormat: string;
}): Promise<ActionResult> {
  const t = await getTranslations("serverErrors");

  if (!isDateFormat(input.dateFormat) || !isNumberFormat(input.numberFormat)) {
    return actionError(t("unknownFormat"));
  }

  const dateFormat = input.dateFormat === "auto" ? null : input.dateFormat;
  const numberFormat =
    input.numberFormat === "auto" ? null : input.numberFormat;

  return runAction("setFormatPreferences", async () => {
    await writeFormatCookies({ dateFormat, numberFormat });

    const user = await getCurrentUser();
    if (user) {
      await saveUserFormatPreferences(user.userId, {
        dateFormat,
        numberFormat,
      });
    }
  });
}
