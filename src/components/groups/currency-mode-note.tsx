"use client";

import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import type { CurrencyMode } from "@/modules/currencies/conversion";

/**
 * How the group handles a second currency, and why that cannot be changed.
 *
 * In the words the group was created with: the create sheet offers "One shared
 * balance" or "A balance per currency", so that is what the group is called
 * here too. It used to read "Currency mode: Converted to EUR · Fixed", which
 * named a setting nobody had been shown and left "Fixed" to sound like an
 * exchange rate. The lock says it cannot be changed; the sentence says why.
 */
export function CurrencyModeNote({
  currencyMode,
  baseCurrency,
}: {
  currencyMode: CurrencyMode;
  baseCurrency: string | null;
}) {
  const t = useTranslations("settingsPage");

  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Lock
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        {currencyMode === "converted"
          ? t("modeConverted", { currency: baseCurrency ?? "" })
          : t("modeSeparate")}
      </p>
      <p className="text-xs text-pretty text-muted-foreground">
        {t("modeFixed")}
      </p>
    </div>
  );
}
