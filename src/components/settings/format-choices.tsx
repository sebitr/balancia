"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { toastUndoable } from "@/components/ui/sonner";
import { ChoiceCard } from "./choice-card";
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
 * The two are written together, because the action takes both, but they are
 * two decisions — so each has its own named toast. Changing one does not take
 * away the chance to undo the other, and changing the same one twice replaces
 * its own confirmation rather than adding to a pile. Undoing writes the old
 * pair the same way and says nothing more.
 *
 * The router is refreshed afterwards because every date and amount on screen
 * was written by the server.
 */
type Formats = { dateFormat: DateFormat; numberFormat: NumberFormat };

export function FormatChoices() {
  const router = useRouter();
  const t = useTranslations("userSettings");
  const tCommon = useTranslations("common");
  const { dateFormat, numberFormat, formatLocale } = useFormatPreferences();
  const [chosen, setChosen] = useState<Formats>({ dateFormat, numberFormat });
  const [isPending, startTransition] = useTransition();

  /** `undo` names the card that changed, and is the toast it replaces. */
  const save = (next: Formats, undo?: "dateFormat" | "numberFormat") => {
    const previous = chosen;
    setChosen(next);
    startTransition(async () => {
      const result = await setFormatPreferencesAction(next);
      if (!result.ok) {
        // Back to what is actually stored: a card left showing a choice the
        // account did not keep is worse than no confirmation at all.
        setChosen(previous);
        toast.error(result.error ?? t("formatsFailed"));
        return;
      }
      if (undo) {
        toastUndoable(
          t("formatsSaved"),
          { label: tCommon("undo"), onUndo: () => save(previous) },
          { id: `format-${undo}` },
        );
      }
      router.refresh();
    });
  };

  /** "Automatic (13/08/2026)" — the label names the choice, the sample proves it. */
  const label = (isAuto: boolean, sample: string) =>
    isAuto ? t("formatAuto", { sample }) : sample;

  return (
    <>
      <ChoiceCard
        name="date-format"
        label={t("dates")}
        value={chosen.dateFormat}
        disabled={isPending}
        choices={DATE_FORMATS.map((format) => ({
          value: format,
          label: label(
            format === "auto",
            dateFormatSample(format, formatLocale),
          ),
        }))}
        onChoose={(next) => save({ ...chosen, dateFormat: next }, "dateFormat")}
      />

      <ChoiceCard
        name="number-format"
        label={t("numbers")}
        value={chosen.numberFormat}
        disabled={isPending}
        choices={NUMBER_FORMATS.map((format) => ({
          value: format,
          label: label(
            format === "auto",
            numberFormatSample(format, formatLocale),
          ),
        }))}
        onChoose={(next) =>
          save({ ...chosen, numberFormat: next }, "numberFormat")
        }
      />
    </>
  );
}
