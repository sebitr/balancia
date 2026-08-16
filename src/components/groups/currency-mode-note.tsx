"use client";

import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CurrencyMode } from "@/modules/currencies/conversion";

/**
 * What this group does with currencies, and why it is not a control.
 *
 * The mode is chosen once, when the group is created, and every amount
 * recorded since has been stored under it — so this is a line at the foot of
 * Details rather than a card of its own with something to press in it. The
 * badge says why there is nothing to press.
 */
export function CurrencyModeNote({
  currencyMode,
  baseCurrency,
}: {
  currencyMode: CurrencyMode;
  baseCurrency: string | null;
}) {
  const t = useTranslations("settingsPage");
  const converted = currencyMode === "converted";
  const currency = baseCurrency ?? "";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{t("currencyMode")}</span>
        <span className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">
            {converted
              ? t("currencyModeConverted", { currency })
              : t("currencyModeSeparate")}
          </span>
          <Badge variant="secondary">
            <Lock aria-hidden="true" />
            {t("currencyModeFixed")}
          </Badge>
        </span>
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        {converted ? t("convertedNote", { currency }) : t("separateNote")}{" "}
        {t("modeFixed")}
      </p>
    </div>
  );
}
