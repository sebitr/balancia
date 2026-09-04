"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { CurrencyHeading } from "@/components/money/currency-heading";
import { useNumberLocale } from "@/i18n/format-context";
import { formatMoney, money } from "@/modules/currencies/money";
import { cn } from "@/lib/utils";
import { TONE, toneFor } from "@/components/money/balance-tone";

/**
 * One currency's position, and the ledger that produced it.
 *
 * Shared by both shapes the overview's position takes — the single-currency
 * hero and the multi-currency tile grid — because the arithmetic behind a
 * balance does not change with how many currencies sit beside it. The sheet
 * that holds these is each card's own; only the explanation is common.
 */
export interface PositionView {
  readonly currency: string;
  readonly minorUnits: string;
  readonly counterparties: readonly {
    readonly participantId: string;
    readonly name: string;
    readonly minorUnits: string;
  }[];
  readonly breakdown: {
    readonly paid: string;
    readonly share: string;
    readonly revenueReceived: string;
    readonly revenueCredited: string;
    readonly settlementsPaid: string;
    readonly settlementsReceived: string;
    readonly otherAdjustments: string;
  };
}

type SectionKey = "expenses" | "revenue" | "settlements";

/** Which way a pair of raw totals leans, and by how much. */
export interface Comparison {
  readonly side: "more" | "less" | "equal";
  /** Never negative: the figure the sentence names, nothing when level. */
  readonly gap: bigint;
}

/**
 * How far one total ran ahead of the other.
 *
 * Level is an answer of its own rather than a gap of zero, because "you paid
 * 0.00 less than your share" is a sentence nobody should be shown — a reader
 * whose two figures match wants to be told they match.
 */
export function compareToShare(mine: bigint, share: bigint): Comparison {
  if (mine > share) return { side: "more", gap: mine - share };
  if (mine < share) return { side: "less", gap: share - mine };
  return { side: "equal", gap: 0n };
}

/** The sentence a leaning pair calls for, once it is known to lean. */
const EXPENSE_SENTENCES = {
  more: "positionExpensesMore",
  less: "positionExpensesLess",
} as const;

const REVENUE_SENTENCES = {
  more: "positionRevenueMore",
  less: "positionRevenueLess",
} as const;

/**
 * The ledger behind one currency's position, in three collapsible groups.
 *
 * The old sheet listed six signed rows and asked the reader to add them up.
 * Grouping them into expenses, revenue and settlements means the resulting
 * balance is the sum of three numbers, each of which is itself two — and it
 * gives income a name. It used to arrive as "Other adjustments", which in a
 * group that collects rent is the largest figure on the screen.
 *
 * Sign convention throughout: money the reader holds on the group's behalf
 * lowers their balance. Collecting income is negative; being credited part of
 * it is positive. That is an expense run backwards, which is what income is
 * everywhere else in the app.
 *
 * A sign is reserved for that effect and never spent on anything else. The
 * six figures inside the sections are raw totals — what was paid, what was
 * owed — and a reader asked to work out why "+290.00" and "−436.67" belong to
 * the same bill has been handed the arithmetic back. So each row states its
 * amount plainly, the signed figure in each section header is the subtotal's
 * effect on the balance, and the sentence under the pair says which way the
 * difference ran, in words that survive without the sign.
 */
export function PositionBreakdown({
  position,
  showCurrency,
}: {
  position: PositionView;
  showCurrency: boolean;
}) {
  const t = useTranslations("group");
  const locale = useNumberLocale();
  // Closed to start with. Opened out, the three sections and their sentences
  // run past the fold on a phone, so the one line the sheet exists to explain
  // — the resulting balance — is the one line you cannot see. Each section
  // states its own subtotal shut, which is the answer most of the time; the
  // two rows behind it are for the times it is not.
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    expenses: false,
    revenue: false,
    settlements: false,
  });

  const { currency, breakdown } = position;
  const paid = BigInt(breakdown.paid);
  const share = BigInt(breakdown.share);
  const revenueReceived = BigInt(breakdown.revenueReceived);
  const revenueCredited = BigInt(breakdown.revenueCredited);
  const settlementsPaid = BigInt(breakdown.settlementsPaid);
  const settlementsReceived = BigInt(breakdown.settlementsReceived);
  const otherAdjustments = BigInt(breakdown.otherAdjustments);
  const result = BigInt(position.minorUnits);

  /** An amount set inside a sentence, in the notation the rows use. */
  const inline = (amount: bigint) =>
    formatMoney(money(amount, currency), { locale, display: "code" });

  const expenses = compareToShare(paid, share);
  const revenue = compareToShare(revenueReceived, revenueCredited);

  const sections: readonly {
    key: SectionKey;
    title: string;
    summary: string;
    subtotal: bigint;
    rows: readonly { key: string; label: string; value: bigint }[];
  }[] = [
    {
      key: "expenses",
      title: t("positionSectionExpenses"),
      summary:
        expenses.side === "equal"
          ? t("positionExpensesEqual")
          : t(EXPENSE_SENTENCES[expenses.side], {
              amount: inline(expenses.gap),
            }),
      subtotal: paid - share,
      rows: [
        { key: "paid", label: t("positionYouPaid"), value: paid },
        { key: "share", label: t("positionYourShare"), value: share },
      ],
    },
    {
      key: "revenue",
      title: t("positionSectionRevenue"),
      summary:
        revenue.side === "equal"
          ? t("positionRevenueEqual")
          : t(REVENUE_SENTENCES[revenue.side], { amount: inline(revenue.gap) }),
      subtotal: revenueCredited - revenueReceived,
      rows: [
        {
          key: "received",
          label: t("positionRevenueReceived"),
          value: revenueReceived,
        },
        {
          key: "credited",
          label: t("positionRevenueCredited"),
          value: revenueCredited,
        },
      ],
    },
    {
      key: "settlements",
      title: t("positionSectionSettlements"),
      summary: t("positionSettlementsCaption"),
      subtotal: settlementsPaid - settlementsReceived,
      rows: [
        {
          key: "settlementsPaid",
          label: t("positionSettlementsPaid"),
          value: settlementsPaid,
        },
        {
          key: "settlementsReceived",
          label: t("positionSettlementsReceived"),
          value: settlementsReceived,
        },
      ],
    },
  ];

  // One heading level down when a currency heading sits above the sections.
  const SectionHeading = showCurrency ? "h4" : "h3";

  return (
    <div className="flex flex-col gap-2.5">
      {showCurrency && (
        <CurrencyHeading as="h3" currency={currency} className="px-1" />
      )}

      {sections.map((section) => {
        const expanded = open[section.key];
        return (
          <section
            key={section.key}
            className="rounded-2xl bg-card ring-1 ring-border"
          >
            <SectionHeading>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() =>
                  setOpen((state) => ({
                    ...state,
                    [section.key]: !state[section.key],
                  }))
                }
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-colors hover:bg-wash-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="flex items-center gap-[7px] text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "size-[13px] shrink-0 transition-transform duration-150 motion-reduce:transition-none",
                      expanded ? "rotate-0" : "-rotate-90",
                    )}
                  />
                  {section.title}
                </span>
                <Amount
                  minorUnits={section.subtotal.toString()}
                  currency={currency}
                  display="code"
                  signDisplay="exceptZero"
                  className="shrink-0 text-xs font-semibold"
                />
              </button>
            </SectionHeading>

            {expanded && (
              <div className="border-t">
                <dl className="px-3.5">
                  {section.rows.map((row) => (
                    <div
                      key={row.key}
                      className="flex min-h-11 items-center justify-between gap-4 border-t first:border-t-0"
                    >
                      <dt className="text-sm text-muted-foreground">
                        {row.label}
                      </dt>
                      {/* No sign: these are the totals themselves, and the
                          only thing a sign here ever meant was which side of
                          the subtraction above they stood on. */}
                      <dd className="text-sm font-medium tabular-nums">
                        <Amount
                          minorUnits={row.value.toString()}
                          currency={currency}
                          display="code"
                        />
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="px-3.5 pb-3 text-xs leading-[1.45] text-pretty text-muted-foreground">
                  {section.summary}
                </p>
              </div>
            )}
          </section>
        );
      })}

      {otherAdjustments !== 0n && (
        <div className="flex min-h-11 items-center justify-between gap-4 rounded-2xl bg-card px-3.5 ring-1 ring-border">
          <span className="text-sm text-muted-foreground">
            {t("positionOtherAdjustments")}
          </span>
          <Amount
            minorUnits={otherAdjustments.toString()}
            currency={currency}
            display="code"
            signDisplay="exceptZero"
            className="text-sm font-medium"
          />
        </div>
      )}

      <div className="flex min-h-14 items-center justify-between gap-4 rounded-2xl bg-muted px-3.5 py-3 ring-1 ring-border">
        <span className="text-sm font-semibold">{t("positionResult")}</span>
        <Amount
          minorUnits={position.minorUnits}
          currency={currency}
          display="code"
          signDisplay="exceptZero"
          className={cn(
            "shrink-0 text-base font-semibold",
            TONE[toneFor(result)].ink,
          )}
        />
      </div>
    </div>
  );
}
