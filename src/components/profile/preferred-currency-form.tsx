"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CurrencySelect } from "@/components/money/currency-select";
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

  const choose = (currency: string) => {
    startTransition(async () => {
      const result = await setPreferredCurrencyAction(currency);
      if (!result.ok) {
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
      <CurrencySelect
        id="preferred-currency"
        defaultValue={defaultValue ?? "EUR"}
        disabled={isPending}
        onChange={choose}
        className="max-w-sm"
      />
      <p className="text-xs text-muted-foreground">{t("currencyHelp")}</p>
    </div>
  );
}
