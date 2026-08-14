"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SheetTitle } from "@/components/ui/sheet";
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "@/modules/categorization";
import { ChoicePill } from "./pills";

/**
 * Picking a category, when the classifier's guess is wrong or missing.
 *
 * The category itself is a row in the card beside the description — this is
 * only the sheet that row opens.
 */

export function CategorySheet({
  value,
  detectedValue,
  onSelect,
  onDone,
}: {
  value: string;
  /** What the classifier would say, so an override can be handed back. */
  detectedValue: string;
  onSelect: (category: string) => void;
  onDone: () => void;
}) {
  const t = useTranslations("addEntry.category");
  const tCategories = useTranslations("expenses.categories");
  const locale = useLocale();

  /** The reader's own alphabetical order, with `other` pinned last. */
  const ordered = useMemo(() => {
    const collator = new Intl.Collator(locale);
    const named = EXPENSE_CATEGORIES.filter(
      (category) => category !== "other",
    ).map((category) => ({
      category,
      label: tCategories(category),
    }));
    named.sort((a, b) => collator.compare(a.label, b.label));
    return [
      ...named,
      { category: "other" as ExpenseCategory, label: tCategories("other") },
    ];
  }, [locale, tCategories]);

  const overridden = detectedValue !== "" && value !== detectedValue;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <SheetTitle className="text-[19px] font-semibold tracking-[-0.02em]">
          {t("title")}
        </SheetTitle>
        {overridden && (
          <button
            type="button"
            onClick={() => onSelect(detectedValue)}
            className="text-[13px] text-primary underline underline-offset-2"
          >
            {t("backToDetected")}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {ordered.map(({ category, label }) => (
          <ChoicePill
            key={category}
            selected={category === value}
            onClick={() => onSelect(category)}
          >
            {label}
          </ChoicePill>
        ))}
      </div>

      <Button type="button" size="lg" className="h-13" onClick={onDone}>
        {t("done")}
      </Button>
    </div>
  );
}
