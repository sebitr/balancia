"use client";

import { useCallback, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useNumberLocale } from "@/i18n/format-context";
import {
  TONE,
  toneFor,
  type BalanceTone,
} from "@/components/money/balance-tone";
import { formatMoney, money } from "@/modules/currencies/money";
import { TYPE_GLYPHS } from "@/components/expenses/category-icon";
import { cn } from "@/lib/utils";
import type { EntryKind, RowView } from "./list-filter";

/**
 * The parts of a transaction's line that the phone's row and the desktop's
 * table both draw: the badge that says what kind of row it is, and the
 * reader's own line under the total.
 *
 * Two renderers of one list have to say the same thing in the same words, so
 * these are drawn once, here, and placed by each. Where they sit is the
 * renderer's business — under the title on a phone, inline beside it in a
 * table cell — which is why neither carries a margin of its own.
 */

/**
 * Who put the money in, said as a sentence: "You paid", "Jonas and Ravi
 * paid", "You and Grace paid". Null on a row nobody paid.
 *
 * The table's folded line and the phone's second line both say it, so it is
 * worded once, here. The returned function is stable for a given reader and
 * language, so a list can hand it to every row without making new ones.
 */
export function usePayerLine(
  self: string | null,
): (row: RowView) => string | null {
  const t = useTranslations("expensesList.table");
  const namesOf = usePayerNames(self);

  return useCallback(
    (row: RowView) => {
      if (row.payers.length === 0) return null;
      const names = namesOf(row);
      return t("paidByLine", {
        who:
          self !== null && row.payers.length === 1 && row.payers[0] === self
            ? "you"
            : self !== null && row.payers.includes(self)
              ? "withYou"
              : "other",
        names,
        count: row.payers.length,
      });
    },
    [t, namesOf, self],
  );
}

/**
 * The payers' names alone, joined the way the language joins them — "Jonas
 * and Ravi", "Jonas et Ravi" — with "You" in the reader's place. The table's
 * Paid by column prints this; `usePayerLine` makes a sentence of it.
 */
export function usePayerNames(self: string | null): (row: RowView) => string {
  const t = useTranslations("expensesList.table");
  const locale = useLocale();
  // One formatter for every row's payers rather than one per row.
  const list = useMemo(
    () => new Intl.ListFormat(locale, { style: "long", type: "conjunction" }),
    [locale],
  );

  return useCallback(
    (row: RowView) =>
      list.format(
        row.payers.map((payer, index) =>
          payer === self ? t("you") : (row.payerNames[index] ?? ""),
        ),
      ),
    [t, list, self],
  );
}

export type BadgeKind = "revenue" | "settlement" | "recurring";

/**
 * The one badge a row wears, if any.
 *
 * Income and a repayment are what the row *is*, and outrank the recurring
 * badge, which is only where it came from.
 */
export function badgeOf(row: RowView): BadgeKind | null {
  if (row.revenue) return "revenue";
  if (row.kind === "settlement") return "settlement";
  if (row.recurring) return "recurring";
  return null;
}

export function TypeBadge({ kind }: { kind: BadgeKind }) {
  const t = useTranslations("expensesList");
  const Glyph = TYPE_GLYPHS[kind];
  const label = t(
    kind === "revenue"
      ? "revenueBadge"
      : kind === "settlement"
        ? "paymentBadge"
        : "recurringBadge",
  );

  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full px-2 text-2xs font-semibold",
        kind === "revenue" && "bg-positive/15 text-positive-ink",
        kind === "settlement" && "border text-foreground",
        kind === "recurring" && "bg-accent text-accent-foreground",
      )}
    >
      <Glyph aria-hidden="true" className="size-[11px] shrink-0" />
      {label}
    </span>
  );
}

/**
 * What the row left the reader holding, said in words.
 *
 * It used to be a sign and a colour — "+ €60.00", "− €30.00" — with the word
 * read out to a screen reader and kept from everyone else, so the colour was
 * doing the explaining. Worse, a repayment the reader had *received* printed
 * "− €30.00" too, because a repayment is neutral and the neutral tone signs
 * with a minus. A sentence cannot be read the wrong way round: "you get back
 * €60.00", "you owe €30.00", and for a repayment, which way the money went —
 * "you received", "you paid".
 *
 * The figure carries no sign now: the words say which way it goes, and a
 * minus inside "you owe" would say it twice and read as a typo. The line
 * starts with the words, so it starts with a capital — the expense's own
 * screen writes its outcomes the same way, and the two should read alike.
 *
 * The colour stays, from `TONE`, so the eye can still sort a column of them at
 * a glance. A repayment stays neutral: it closes a position rather than
 * opening one. A row the reader is not in has no position and says nothing.
 */
export function Position({
  minorUnits,
  currency,
  kind,
  className,
}: {
  minorUnits: string;
  currency: string;
  /** A repayment's position is which way the money went, not a debt. */
  kind: EntryKind;
  className?: string;
}) {
  const t = useTranslations("expensesList");
  const locale = useNumberLocale();
  const signed = BigInt(minorUnits);
  const direction = toneFor(signed);
  const repayment = kind === "settlement";
  const tone: BalanceTone = repayment ? "neutral" : direction;
  const amount = formatMoney(money(signed < 0n ? -signed : signed, currency), {
    locale,
  });

  const words =
    direction === "neutral"
      ? t("positionEven", { kind })
      : repayment
        ? direction === "positive"
          ? t("positionYouReceived", { amount })
          : t("positionYouPaid", { amount })
        : direction === "positive"
          ? t("positionYouGetBack", { amount })
          : t("positionYouOwe", { amount });

  return (
    // A sentence, so the caption size rather than the label floor; and on one
    // line, because a figure broken from its words reads as two facts.
    <span
      className={cn(
        "text-xs font-medium whitespace-nowrap tabular-nums",
        TONE[tone].ink,
        className,
      )}
    >
      {words}
    </span>
  );
}
