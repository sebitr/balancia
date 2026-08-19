"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SheetTitle } from "@/components/ui/sheet";
import { CATEGORY_GLYPHS } from "@/components/expenses/category-icon";
import {
  EXPENSE_CATEGORIES,
  type ClassificationResult,
  type ExpenseCategory,
} from "@/modules/categorization";
import { categoryShortlist } from "./entry-logic";
import { ChoicePill } from "./pills";

/**
 * Picking a category, when the classifier's guess is wrong or missing.
 *
 * The category itself is a row in the card beside the description — this is
 * only the sheet that row opens.
 *
 * It leads with a few chips rather than the whole vocabulary. Eighteen
 * categories in the reader's alphabet is a wall, and the one they want is
 * rarely near the top of it: it is either what the description already says or
 * what this group files most things under. Both are known before the sheet
 * opens, so the wall goes underneath and the answer goes on top.
 *
 * The heading over those chips says which of the two it is, and it has to stay
 * honest — "Because it says…" over a list the description had no part in would
 * be the interface claiming to have read something it did not.
 *
 * Tapping a chip picks and closes. A Done button under a grid of one-tap
 * choices asks people to confirm a decision they have already expressed, and
 * the sheet has nothing else to collect.
 */

export function CategorySheet({
  value,
  detectedValue,
  description,
  suggestion,
  frequent,
  onSelect,
  onRevert,
}: {
  value: string;
  /** What the classifier would say, so an override can be handed back. */
  detectedValue: string;
  /** Quoted in the shortlist heading, so the guess shows its evidence. */
  description: string;
  /** The live classification, or null while there is nothing to classify. */
  suggestion: ClassificationResult | null;
  /** What this group files things under, most used first. */
  frequent: readonly ExpenseCategory[];
  onSelect: (category: string) => void;
  /** Drops the manual override and lets detection have the field back. */
  onRevert: () => void;
}) {
  const t = useTranslations("addEntry.category");
  const tCategories = useTranslations("expenses.categories");
  const locale = useLocale();
  const [query, setQuery] = useState("");

  /** The reader's own alphabetical order, with `other` pinned last. */
  const ordered = useMemo(() => {
    const collator = new Intl.Collator(locale);
    const named = EXPENSE_CATEGORIES.filter(
      (category) => category !== "other",
    ).map((category) => ({ category, label: tCategories(category) }));
    named.sort((a, b) => collator.compare(a.label, b.label));
    return [
      ...named,
      { category: "other" as ExpenseCategory, label: tCategories("other") },
    ];
  }, [locale, tCategories]);

  const shortlist = useMemo(
    () => categoryShortlist({ suggestion, frequent }),
    [suggestion, frequent],
  );

  const needle = query.trim().toLocaleLowerCase(locale);
  const searching = needle !== "";

  /**
   * Searching drops the grouping and filters everything.
   *
   * A shortlist is an answer to "what do you probably want", and typing is
   * someone saying they want something else. Keeping the suggestions above the
   * results would put three categories they did not ask for over the one they
   * are spelling out.
   *
   * Matching is done on the label rather than the code, because the code is not
   * what is on screen — and it is accent- and case-insensitive, so `sante`
   * finds Santé, which is the whole point on a keyboard that makes accents
   * expensive.
   */
  const results = useMemo(() => {
    if (!searching) return [];
    return ordered.filter(({ label }) =>
      label
        .toLocaleLowerCase(locale)
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .includes(needle.normalize("NFD").replace(/\p{Diacritic}/gu, "")),
    );
  }, [ordered, needle, searching, locale]);

  /** The alphabet minus whatever is already offered above it. */
  const rest = useMemo(
    () =>
      ordered.filter(
        ({ category }) => !shortlist.categories.includes(category),
      ),
    [ordered, shortlist],
  );

  const overridden = detectedValue !== "" && value !== detectedValue;

  const chip = ({
    category,
    label,
  }: {
    category: ExpenseCategory;
    label: string;
  }) => (
    <ChoicePill
      key={category}
      selected={category === value}
      icon={CATEGORY_GLYPHS[category]}
      onClick={() => onSelect(category)}
    >
      {label}
    </ChoicePill>
  );

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <SheetTitle className="text-lg font-semibold tracking-[-0.02em]">
          {t("title")}
        </SheetTitle>
        {overridden && (
          <button
            type="button"
            onClick={onRevert}
            className="shrink-0 text-xs text-primary underline underline-offset-2"
          >
            {t("backToDetected")}
          </button>
        )}
      </div>

      <div className="relative shrink-0">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          className="h-12 pl-9"
        />
      </div>

      <div className="-mx-1 min-h-0 flex-auto space-y-4 overflow-y-auto px-1 pb-1">
        {searching ? (
          <Group heading={t("results")}>
            {results.map(chip)}
            {results.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">
                {t("noMatch")}
              </p>
            )}
          </Group>
        ) : (
          <>
            {shortlist.categories.length > 0 && (
              <Group
                heading={
                  shortlist.fromDescription
                    ? t("because", { description: description.trim() })
                    : t("mostUsed")
                }
              >
                {shortlist.categories.map((category) =>
                  chip({ category, label: tCategories(category) }),
                )}
              </Group>
            )}
            <Group heading={t("all")}>{rest.map(chip)}</Group>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A heading and the chips under it.
 *
 * The heading is a real one rather than styled text: it is how somebody
 * arrowing through the sheet finds out that these three chips are a shortlist
 * and the twelve below are the rest.
 */
function Group({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="line-clamp-1 text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {heading}
      </h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}
