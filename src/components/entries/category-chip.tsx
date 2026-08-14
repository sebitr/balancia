"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  EXPENSE_CATEGORIES,
  isExpenseCategory,
  type ExpenseCategory,
} from "@/modules/categorization";
import { ChoicePill } from "./pills";

/**
 * The category, as a chip beside the description rather than a field below it.
 *
 * Category is optional and usually guessed correctly, so it should cost no
 * vertical space until someone disagrees with the guess. Three states, and the
 * helper text beside the chip is what distinguishes them:
 *
 *  - **detected** — the classifier filled it in; an amber sparkle marks that
 *    it was read from the description rather than chosen.
 *  - **chosen** — someone picked it, and from then on the classifier stops.
 *  - **empty** — a dashed outline inviting a choice, and nothing more.
 */

export function CategoryChip({
  value,
  detected,
  onOpen,
}: {
  value: string;
  /** True when `value` came from the classifier rather than a person. */
  detected: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("addEntry.category");
  const tCategories = useTranslations("expenses.categories");

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "inline-flex h-[30px] items-center gap-1.5 rounded-full px-3 text-xs transition-colors",
          value
            ? "border border-border bg-accent font-medium text-foreground"
            : "border border-dashed border-white/22 text-muted-foreground",
        )}
      >
        {detected && value && (
          <Sparkles aria-hidden="true" className="size-3 text-chart-4" />
        )}
        {isExpenseCategory(value) ? tCategories(value) : t("add")}
        <ChevronDown aria-hidden="true" className="size-3" />
      </button>

      <span className="text-xs text-muted-foreground">
        {value ? (detected ? t("detected") : t("chosen")) : t("optional")}
      </span>
    </div>
  );
}

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
