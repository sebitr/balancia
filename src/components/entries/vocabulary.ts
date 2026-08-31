"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import {
  CATEGORY_GLYPHS,
  FALLBACK_GLYPH,
  SUBCATEGORY_GLYPHS,
  hasGlyph,
} from "@/components/expenses/category-icon";
import {
  EXPENSE_CATEGORY_IDS,
  INCOME_CATEGORY_IDS,
  getIncomeSubcategories,
  getSubcategories,
  getSubcategoryGroups,
  isExpenseCategory,
  isIncomeCategory,
} from "@/modules/categorization";
import type { EntryDirection } from "@/modules/expenses/direction";
import {
  INCOME_CATEGORY_GLYPHS,
  INCOME_SUBCATEGORY_GLYPHS,
  hasIncomeGlyph,
} from "./income-icons";

/**
 * One category picker, two vocabularies.
 *
 * The sheet was written against `ExpenseCategory` in a dozen places — the id
 * list, three translation namespaces, two glyph maps, the subcategory lookup
 * and the group headings. Income needs all of the same shapes and none of the
 * same values, and threading `direction` through each call site would put the
 * choice in a dozen places rather than one.
 *
 * So the direction is resolved once, here, into the handful of questions the
 * sheet actually asks. Everything below the sheet takes plain strings: a code
 * is data, and which vocabulary it belongs to is already settled by the time
 * a chip is drawn.
 *
 * The unchecked casts are the same one `useSubcategoryLabel` already carried
 * and for the same reason: `t()` is typed over the literal key paths in
 * `en.json`, and `${category}.${leaf}` is a cross product whose valid corner
 * the taxonomy — not the key type — is what guarantees. Every caller iterates
 * `leaves()`, so every pair asked for is one the taxonomy named.
 */
export interface Vocabulary {
  /** Every category code, in declaration order. */
  readonly ids: readonly string[];
  /** The reader's word for a category. */
  readonly label: (category: string) => string;
  /** The reader's word for a (category, subcategory) pair. */
  readonly leafLabel: (category: string, leaf: string) => string;
  readonly glyph: (category: string) => LucideIcon;
  readonly leafGlyph: (category: string, leaf: string) => LucideIcon;
  /** What may sit under a category. Empty when nothing may. */
  readonly leaves: (category: string) => readonly string[];
  /**
   * The headings a category's leaves sit under, or null for a flat pane.
   *
   * Presentation only — never stored, never an id on the entry. Only the
   * expense vocabulary has any; income's longest pane is seven leaves, which
   * is a list rather than something needing signposts.
   */
  readonly groups: (
    category: string,
  ) => readonly { group: string; subcategories: readonly string[] }[] | null;
  /** Whether this vocabulary claims a code at all. */
  readonly owns: (category: string) => boolean;
}

export function useVocabulary(direction: EntryDirection): Vocabulary {
  const tExpense = useTranslations("expenses.categories");
  const tExpenseLeaf = useTranslations("expenses.subcategories");
  const tIncome = useTranslations("expenses.incomeCategories");
  const tIncomeLeaf = useTranslations("expenses.incomeSubcategories");

  return useMemo(() => {
    if (direction === "in") {
      return {
        ids: INCOME_CATEGORY_IDS,
        label: (category) => tIncome(category as Parameters<typeof tIncome>[0]),
        leafLabel: (category, leaf) =>
          tIncomeLeaf(
            `${category}.${leaf}` as Parameters<typeof tIncomeLeaf>[0],
          ),
        glyph: (category) =>
          hasIncomeGlyph(category)
            ? INCOME_CATEGORY_GLYPHS[category]
            : FALLBACK_GLYPH,
        leafGlyph: (category, leaf) => {
          if (!hasIncomeGlyph(category)) return FALLBACK_GLYPH;
          const leaves = INCOME_SUBCATEGORY_GLYPHS[category] as Readonly<
            Record<string, LucideIcon>
          >;
          return leaves[leaf] ?? FALLBACK_GLYPH;
        },
        leaves: (category) =>
          isIncomeCategory(category) ? getIncomeSubcategories(category) : [],
        groups: () => null,
        owns: isIncomeCategory,
      } satisfies Vocabulary;
    }

    return {
      ids: EXPENSE_CATEGORY_IDS,
      label: (category) => tExpense(category as Parameters<typeof tExpense>[0]),
      leafLabel: (category, leaf) =>
        tExpenseLeaf(
          `${category}.${leaf}` as Parameters<typeof tExpenseLeaf>[0],
        ),
      glyph: (category) =>
        hasGlyph(category) ? CATEGORY_GLYPHS[category] : FALLBACK_GLYPH,
      leafGlyph: (category, leaf) => {
        if (!hasGlyph(category)) return FALLBACK_GLYPH;
        const leaves = SUBCATEGORY_GLYPHS[category] as Readonly<
          Record<string, LucideIcon>
        >;
        return leaves[leaf] ?? FALLBACK_GLYPH;
      },
      leaves: (category) =>
        isExpenseCategory(category) ? getSubcategories(category) : [],
      groups: (category) =>
        isExpenseCategory(category) ? getSubcategoryGroups(category) : null,
      owns: isExpenseCategory,
    } satisfies Vocabulary;
  }, [direction, tExpense, tExpenseLeaf, tIncome, tIncomeLeaf]);
}
