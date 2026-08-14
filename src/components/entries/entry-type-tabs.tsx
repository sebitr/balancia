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
 * The active ring is coloured per type — coral for spending, green for money
 * in, plain white for a repayment — so the amount below is never the first
 * place you learn which mode you are in.
 */

const TYPES: readonly EntryType[] = ["expense", "income", "settle"];

const ACTIVE_RING: Record<EntryType, string> = {
  expense: "shadow-[inset_0_0_0_1px] shadow-primary/50",
  income: "shadow-[inset_0_0_0_1px] shadow-positive/50",
  settle: "shadow-[inset_0_0_0_1px] shadow-white/20",
};

export function EntryTypeTabs({
  value,
  onChange,
}: {
  value: EntryType;
  onChange: (next: EntryType) => void;
}) {
  const t = useTranslations("addEntry.types");

  return (
    <div
      role="tablist"
      aria-label={t("label")}
      className="flex gap-1 rounded-2xl bg-muted p-1"
    >
      {TYPES.map((type) => {
        const active = type === value;
        return (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(type)}
            className={cn(
              "h-10 flex-1 rounded-[11px] text-sm transition-colors",
              active
                ? cn(
                    "bg-accent font-semibold text-foreground",
                    ACTIVE_RING[type],
                  )
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
