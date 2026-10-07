"use client";

import { useTranslations } from "next-intl";
import { rovingChoice } from "@/components/ui/roving-choice";
import { cn } from "@/lib/utils";
import type { EntryType } from "./entry-logic";

/**
 * Expense · Income · Repayment.
 *
 * A segmented control rather than three screens, because the three share
 * almost everything: the same amount, the same date, the same people. Only the
 * amount colour, one middle block and the primary button differ, and a person
 * who picked the wrong one should be able to fix it without losing what they
 * already typed.
 *
 * The selected tab is a filled pill and nothing more. It used to carry a ring
 * coloured per type as well, which drew a second edge a millimetre inside the
 * first and read as a seam rather than as emphasis; the fill and the weight
 * already say which of three it is.
 *
 * Its corners are derived rather than eyeballed: a rounded box inset by `p`
 * inside another only looks concentric when the inner radius is the outer one
 * minus `p`. A literal value here drifts the moment `--radius` is retuned.
 *
 * On a desk the three sit in the dialog's title row, beside the title, each as
 * wide as its word: the drawer's full-width row under the title was the
 * phone's answer to a screen too narrow to hold both on one line.
 */

export const ALL_ENTRY_TYPES: readonly EntryType[] = [
  "expense",
  "income",
  "settle",
];

/**
 * The id a tab goes by, so the panel it controls can be named after it.
 *
 * The panel is the form below, which lives in another component, so the
 * scheme is written once here and read from both sides.
 */
export function entryTypeTabId(panelId: string, type: EntryType): string {
  return `${panelId}-${type}`;
}

/**
 * These are real tabs, and behave like them: one stop on the Tab key, the
 * arrows to move between the three, and each tab pointing at the form it
 * switches — `panelId` names it, and the form carries `role="tabpanel"`.
 */
export function EntryTypeTabs({
  value,
  onChange,
  types = ALL_ENTRY_TYPES,
  panelId,
  compact = false,
}: {
  value: EntryType;
  onChange: (next: EntryType) => void;
  /**
   * Which of the three to offer. All of them, unless the caller knows one
   * cannot work — the offline drawer drops Repayment, which needs balances no
   * device can compute on its own.
   *
   * A tab is removed rather than disabled: a control that is visible and
   * refuses is a puzzle, and the reason ("we cannot know who owes whom right
   * now") does not fit on a pill.
   */
  types?: readonly EntryType[];
  /** The id of the form these tabs switch between. */
  panelId: string;
  /** Each tab as wide as its word, for the dialog's title row on a desk. */
  compact?: boolean;
}) {
  const t = useTranslations("addEntry.types");
  const keys = rovingChoice({
    values: types,
    selected: value,
    onSelect: onChange,
  });

  // One tab is not a choice, and a segmented control drawn around it reads as
  // a button that does nothing.
  if (types.length < 2) return null;

  return (
    <div
      role="tablist"
      aria-label={t("label")}
      className={
        compact
          ? "inline-flex shrink-0 gap-0.5 rounded-xl bg-muted p-1"
          : "flex gap-1 rounded-2xl bg-muted p-1"
      }
    >
      {types.map((type) => {
        const active = type === value;
        return (
          <button
            key={type}
            type="button"
            role="tab"
            id={entryTypeTabId(panelId, type)}
            aria-selected={active}
            aria-controls={panelId}
            {...keys(type)}
            onClick={() => onChange(type)}
            className={cn(
              compact
                ? "tap-target h-8 rounded-[calc(var(--radius-xl)_-_--spacing(1))] px-3 text-sm transition-colors"
                : "tap-target h-10 flex-1 rounded-[calc(var(--radius-2xl)_-_--spacing(1))] text-sm transition-colors",
              active
                ? "bg-accent font-semibold text-foreground"
                : "font-medium text-muted-foreground",
            )}
          >
            {t(type)}
          </button>
        );
      })}
    </div>
  );
}
