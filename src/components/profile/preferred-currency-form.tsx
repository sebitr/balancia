"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CurrencyField } from "@/components/money/currency-field";
import { Label } from "@/components/ui/label";
import { setPreferredCurrencyAction } from "@/modules/profile/actions";

/**
 * The currency the home screen totals in.
 *
 * Saved on change rather than behind a Save button — it is one choice with no
 * other field to coordinate with, and the same pattern as the language
 * switcher. The router is refreshed so the total on the home screen is already
 * in the new currency when the user goes back to it.
 */
export function PreferredCurrencyForm({
  defaultValue,
}: {
  defaultValue: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("profile");
  const [isPending, startTransition] = useTransition();
  // The picker states what is chosen rather than merely starting there, so the
  // row has to show the new currency the moment it is picked — and go back to
  // the old one if the save is refused, rather than claiming a choice the
  // account did not keep.
  const [currency, setCurrency] = useState(defaultValue ?? "EUR");

  const choose = (chosen: string) => {
    const previous = currency;
    setCurrency(chosen);
    startTransition(async () => {
      const result = await setPreferredCurrencyAction(chosen);
      if (!result.ok) {
        setCurrency(previous);
        toast.error(result.error ?? t("currencyFailed"));
        return;
      }
      toast.success(t("currencySaved"));
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="preferred-currency">{t("currencyLabel")}</Label>
      <CurrencyField
        id="preferred-currency"
        value={currency}
        disabled={isPending}
        onChange={choose}
        label={t("currencyLabel")}
        className="max-w-sm"
      />
      <p className="text-xs text-muted-foreground">{t("currencyHelp")}</p>
    </div>
  );
}
