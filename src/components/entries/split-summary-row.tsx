"use client";

import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { MemberAvatar } from "./pills";
import type { SplitSummary } from "./entry-logic";

/**
 * Who paid, and how it divides — as one sentence.
 *
 * This row replaces two stacked member lists. In the overwhelming majority of
 * entries the default is already right, so the state is *stated* rather than
 * offered for editing: "Seb paid CHF 84.60 / Split equally between 3 · 28.20
 * each". Tapping opens the editor, and until then the screen stays short
 * enough that the primary button is on it.
 *
 * The computed share is the point. A row that only said "split equally" would
 * make you open the sheet to learn the one number you wanted.
 */

export function SplitSummaryRow({
  payerName,
  amountFormatted,
  summary,
  received = false,
  onOpen,
}: {
  payerName: string;
  amountFormatted: string;
  summary: SplitSummary;
  /** Income was received, not paid. */
  received?: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("addEntry.split");

  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-[17px] bg-card p-3.5 text-left shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)] transition-colors active:bg-accent"
    >
      <span className="flex items-center gap-2">
        <MemberAvatar name={payerName} className="size-6" selected />
        <span className="text-sm font-semibold">
          {received
            ? t("received", { name: payerName })
            : t("paid", { name: payerName })}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {amountFormatted}
        </span>
      </span>

      <ChevronRight
        aria-hidden="true"
        className="col-start-2 row-span-2 row-start-1 size-[18px] text-muted-foreground"
      />

      <span className="text-[13px] text-muted-foreground">
        {t(`summary.${summary.key}`, summary.params)}
      </span>
    </button>
  );
}
