"use client";

import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CurrencyMode } from "@/modules/currencies/conversion";

/** The group's immutable currency mode and the reason it cannot be changed. */
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
  const mode = converted
    ? t("currencyModeConverted", { currency })
    : t("currencyModeSeparate");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium">
          {t("currencyMode", { mode })}
        </span>
        <Badge variant="secondary">
          <Lock aria-hidden="true" />
          {t("currencyModeFixed")}
        </Badge>
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        {converted ? t("convertedNote", { currency }) : t("separateNote")}{" "}
        {t("modeFixed")}
      </p>
    </div>
  );
}
