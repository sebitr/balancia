"use client";

import { MethodMark } from "@/components/settlements/method-mark";
import { useTranslations } from "next-intl";
import { findPaymentMethod } from "@/modules/settlements/payment-methods";

/**
 * Which ways of being paid the account has, as marks rather than as words.
 *
 * Three overlapping tiles say "TWINT, bank transfer, Revolut" in the width a
 * summary has, and say it in the same shapes the settle screen shows to whoever
 * owes the money — which is the point of coming here to check. Preferred first,
 * because that is the one they will be offered.
 *
 * Three at most. A fourth tile makes the stack wider than the label beside it,
 * and the answer this row exists to give — "yes, something is set up" — is
 * already given by the first.
 */
const SHOWN = 3;

export function PayoutsSummary({ methods }: { methods: readonly string[] }) {
  const tMethods = useTranslations("paymentMethods");

  if (methods.length === 0) return null;

  return (
    <span className="flex shrink-0 items-center">
      {methods.slice(0, SHOWN).map((method, index) => (
        <span
          key={method}
          // Overlapped and ringed in the card's own colour, so the stack reads
          // as one object rather than as three tiles that ran into each other.
          className="rounded-[8px] ring-2 ring-card"
          style={{ marginLeft: index === 0 ? 0 : -5 }}
        >
          <MethodMark
            method={findPaymentMethod(method) ?? null}
            label={
              findPaymentMethod(method)
                ? tMethods(method as Parameters<typeof tMethods>[0])
                : method
            }
            size={22}
            unbranded="tile"
          />
        </span>
      ))}
    </span>
  );
}
