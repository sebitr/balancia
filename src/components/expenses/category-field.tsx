"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  EXPENSE_CATEGORIES,
  MAX_ALTERNATIVES,
  THRESHOLDS,
  isExpenseCategory,
  type ClassificationResult,
  type ExpenseCategory,
} from "@/modules/categorization";

/**
 * The category field, and what the classifier has to say about it.
 *
 * Three states, and the difference between them is who decided:
 *
 *  - **detected** — the classifier was sure enough to fill the field in. It
 *    says so, quietly, and the value is a normal editable choice.
 *  - **suggested** — it has candidates but not a decision, so it offers up to
 *    three and the field stays empty until someone picks.
 *  - **nothing** — an ordinary select.
 *
 * No percentages are shown. A confidence score is a number about the
 * classifier, not about the expense, and reading one does not help anybody
 * decide whether dinner was a restaurant.
 */

export function CategoryField({
  id = "category",
  value,
  onChange,
  suggestion,
  detected,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** The live classification, or null while there is nothing to classify. */
  suggestion: ClassificationResult | null;
  /** True when `value` was filled in by the classifier rather than chosen. */
  detected: boolean;
}) {
  const t = useTranslations("expenses.form");
  const tCommon = useTranslations("common");
  const tCategories = useTranslations("expenses.categories");
  const locale = useLocale();

  /**
   * Sorted the way the reader's language sorts, with `other` pinned last —
   * it is the escape hatch, not a peer of the real categories.
   */
  const options = useMemo(() => {
    const collator = new Intl.Collator(locale);
    const named: { category: ExpenseCategory; label: string }[] =
      EXPENSE_CATEGORIES.filter((category) => category !== "other")
        .map((category) => ({ category, label: tCategories(category) }))
        .sort((a, b) => collator.compare(a.label, b.label));
    named.push({ category: "other", label: tCategories("other") });
    return named;
  }, [locale, tCategories]);

  /** A value that is not one of ours came from an import; keep it selectable. */
  const imported = value !== "" && !isExpenseCategory(value) ? value : null;

  /**
   * Only candidates that reached the suggestion threshold, and only when the
   * classifier got that far at all. Below it there is nothing worth offering,
   * and a chip for a 0.15 guess is worse than an empty field.
   */
  const shortlist = useMemo(() => {
    if (!suggestion || suggestion.decision !== "suggested") return [];
    const candidates = [
      ...(suggestion.category
        ? [{ category: suggestion.category, confidence: suggestion.confidence }]
        : []),
      ...suggestion.alternatives,
    ];
    return [...new Map(candidates.map((c) => [c.category, c])).values()]
      .filter(
        (candidate) =>
          candidate.confidence >= THRESHOLDS.suggestMinScore &&
          candidate.category !== value,
      )
      .slice(0, MAX_ALTERNATIVES)
      .map((candidate) => candidate.category);
  }, [suggestion, value]);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {t("category")}{" "}
        <span className="font-normal text-muted-foreground">
          ({tCommon("optional")})
        </span>
      </Label>

      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-colors",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        )}
      >
        <option value="">{t("categoryPlaceholder")}</option>
        {imported && (
          <option value={imported}>
            {t("categoryImported", { value: imported })}
          </option>
        )}
        {options.map((option) => (
          <option key={option.category} value={option.category}>
            {option.label}
          </option>
        ))}
      </select>

      {detected && isExpenseCategory(value) && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles aria-hidden="true" className="size-3.5" />
          {t("categoryDetected")}
        </p>
      )}

      {!detected && shortlist.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("categorySuggestions")}
          </span>
          {shortlist.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => onChange(category)}
              className="rounded-4xl border px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-muted"
            >
              {tCategories(category)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The reader's label for a stored category, falling back to raw text. */
export function useCategoryLabel(): (value: string | null) => string | null {
  const tCategories = useTranslations("expenses.categories");
  return (value) => {
    if (!value) return null;
    return isExpenseCategory(value) ? tCategories(value) : value;
  };
}

export type { ExpenseCategory };
