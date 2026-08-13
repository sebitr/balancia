"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { actionError, runAction, type ActionResult } from "@/lib/actions";
import { getCurrentUser } from "@/lib/security/actor";
import { saveUserPreferredCurrency } from "@/modules/auth/service";
import { isSupportedCurrency } from "@/modules/currencies/iso-4217";

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
