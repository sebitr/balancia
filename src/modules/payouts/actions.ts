"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { actionError, runAction, type ActionResult } from "@/lib/actions";
import { getCurrentUser } from "@/lib/security/actor";
import {
  PayoutValidationError,
  replacePayoutMethods,
  type PayoutMethodView,
} from "./service";

/**
 * Saving how somebody wants to be paid back.
 *
 * One action, taking the whole ordered list — the same shape the currency
 * favourites use, and for the same reason: the order is the owner's and cannot
 * be reconstructed from a single toggle.
 *
 * Unlike the favourites this one is *not* fire-and-forget. A starred currency
 * that fails to save costs somebody a tap on their next device; an IBAN that
 * fails to save costs them the money they were owed, and they will not find
 * out until it does not arrive. So the caller waits, and a rejected detail
 * comes back naming the method it belongs to.
 */

const schema = z.object({
  methods: z
    .array(
      z.object({
        method: z.string().trim().min(2).max(40),
        detail: z.string().max(200).default(""),
      }),
    )
    .max(8),
});

export async function setPayoutMethodsAction(
  input: unknown,
): Promise<ActionResult<readonly PayoutMethodView[]>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const t = await getTranslations("serverValidation");
    return actionError(t("checkForm"));
  }

  const user = await getCurrentUser();
  if (!user) {
    const t = await getTranslations("serverErrors");
    return actionError(t("signedInRequired"));
  }

  const t = await getTranslations("payouts.errors");
  const tMethods = await getTranslations("paymentMethods");

  try {
    const result = await runAction("payouts.set", () =>
      replacePayoutMethods(user.userId, parsed.data.methods),
    );
    if (result.ok) revalidatePath("/settings/money");
    return result;
  } catch (error) {
    if (error instanceof PayoutValidationError) {
      // Named by the method rather than by the field: the sheet shows several
      // at once, and "That IBAN is not valid" does not say which row to look at
      // when two of them take an IBAN.
      const key = error.reason as Parameters<typeof t.has>[0];
      const label: string = tMethods(
        error.method as Parameters<typeof tMethods>[0],
      );
      const reason: string = t.has(key) ? t(key) : t("invalid");
      return actionError(`${label} — ${reason}`);
    }
    throw error;
  }
}
