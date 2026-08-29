"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { EntryType } from "./entry-logic";

/**
 * Expense · Income · Settle.
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
 */

export const ALL_ENTRY_TYPES: readonly EntryType[] = [
  "expense",
  "income",
  "settle",
];

export function EntryTypeTabs({
  value,
  onChange,
  types = ALL_ENTRY_TYPES,
}: {
  value: EntryType;
  onChange: (next: EntryType) => void;
  /**
   * Which of the three to offer. All of them, unless the caller knows one
   * cannot work — the offline drawer drops Settle, which needs balances no
   * device can compute on its own.
   *
   * A tab is removed rather than disabled: a control that is visible and
   * refuses is a puzzle, and the reason ("we cannot know who owes whom right
   * now") does not fit on a pill.
   */
  types?: readonly EntryType[];
}) {
  const t = useTranslations("addEntry.types");

  // One tab is not a choice, and a segmented control drawn around it reads as
  // a button that does nothing.
  if (types.length < 2) return null;

  return (
    <div
      role="tablist"
      aria-label={t("label")}
      className="flex gap-1 rounded-2xl bg-muted p-1"
    >
      {types.map((type) => {
        const active = type === value;
        return (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(type)}
            className={cn(
              "h-10 flex-1 rounded-[calc(var(--radius-2xl)_-_--spacing(1))] text-sm transition-colors",
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
