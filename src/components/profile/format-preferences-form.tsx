"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useFormatPreferences } from "@/i18n/format-context";
import {
  DATE_FORMATS,
  dateFormatSample,
  NUMBER_FORMATS,
  numberFormatSample,
  type DateFormat,
  type NumberFormat,
} from "@/i18n/format";
import { setFormatPreferencesAction } from "@/modules/profile/actions";

/**
 * How dates and numbers are written.
 *
 * Every option labels itself with what it actually produces — "13/08/2026",
 * "1 234 567,89" — rather than with a name for the convention, because the
 * sample is the only description that cannot be misread. `auto` shows the
 * sample it currently resolves to, so choosing it is not a leap of faith.
 *
 * Saved on change rather than behind a Save button, like the currency picker
 * and the language switcher. The router is refreshed afterwards because every
 * date and amount on screen was written by the server.
 */

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export function FormatPreferencesForm() {
  const router = useRouter();
  const t = useTranslations("profile");
  const { dateFormat, numberFormat, formatLocale } = useFormatPreferences();
  const [dateChoice, setDateChoice] = useState<DateFormat>(dateFormat);
  const [numberChoice, setNumberChoice] = useState<NumberFormat>(numberFormat);
  const [isPending, startTransition] = useTransition();

  const save = (next: {
    dateFormat: DateFormat;
    numberFormat: NumberFormat;
  }) => {
    setDateChoice(next.dateFormat);
    setNumberChoice(next.numberFormat);
    startTransition(async () => {
      const result = await setFormatPreferencesAction(next);
      if (!result.ok) {
        toast.error(result.error ?? t("formatsFailed"));
        return;
      }
      toast.success(t("formatsSaved"));
      router.refresh();
    });
  };

  /** "Automatic (13/08/2026)" — the label names the choice, the sample proves it. */
  const label = (isAuto: boolean, sample: string) =>
    isAuto ? t("formatAuto", { sample }) : sample;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="date-format">{t("dateFormatLabel")}</Label>
        <select
          id="date-format"
          value={dateChoice}
          disabled={isPending}
          onChange={(event) =>
            save({
              dateFormat: event.target.value as DateFormat,
              numberFormat: numberChoice,
            })
          }
          className={cn(SELECT_CLASS, "max-w-sm")}
        >
          {DATE_FORMATS.map((format) => (
            <option key={format} value={format}>
              {label(format === "auto", dateFormatSample(format, formatLocale))}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="number-format">{t("numberFormatLabel")}</Label>
        <select
          id="number-format"
          value={numberChoice}
          disabled={isPending}
          onChange={(event) =>
            save({
              dateFormat: dateChoice,
              numberFormat: event.target.value as NumberFormat,
            })
          }
          className={cn(SELECT_CLASS, "max-w-sm")}
        >
          {NUMBER_FORMATS.map((format) => (
            <option key={format} value={format}>
              {label(
                format === "auto",
                numberFormatSample(format, formatLocale),
              )}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-muted-foreground">{t("formatsHelp")}</p>
    </div>
  );
}
