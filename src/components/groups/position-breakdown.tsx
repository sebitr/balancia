"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { CurrencyHeading } from "@/components/money/currency-heading";
import { cn } from "@/lib/utils";

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
 */
export function PositionBreakdown({
  position,
  showCurrency,
}: {
  position: PositionView;
  showCurrency: boolean;
}) {
  const t = useTranslations("group");
  // Closed to start with. Opened out, the three sections and their captions
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

  const sections: readonly {
    key: SectionKey;
    title: string;
    caption: string;
    subtotal: bigint;
    rows: readonly { key: string; label: string; value: bigint }[];
  }[] = [
    {
      key: "expenses",
      title: t("positionSectionExpenses"),
      caption: t("positionExpensesCaption"),
      subtotal: paid - share,
      rows: [
        { key: "paid", label: t("positionYouPaid"), value: paid },
        { key: "share", label: t("positionYourShare"), value: -share },
      ],
    },
    {
      key: "revenue",
      title: t("positionSectionRevenue"),
      caption: t("positionRevenueCaption"),
      subtotal: revenueCredited - revenueReceived,
      rows: [
        {
          key: "received",
          label: t("positionRevenueReceived"),
          value: -revenueReceived,
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
      caption: t("positionSettlementsCaption"),
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
          value: -settlementsReceived,
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
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
                  className="text-xs font-semibold"
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
                      <dd className="text-sm font-medium tabular-nums">
                        <Amount
                          minorUnits={row.value.toString()}
                          currency={currency}
                          display="code"
                          signDisplay="exceptZero"
                        />
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="px-3.5 pb-3 text-xs leading-[1.45] text-pretty text-muted-foreground">
                  {section.caption}
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
        <div className="flex flex-col gap-px">
          <span className="text-sm font-semibold">{t("positionResult")}</span>
          <span className="text-2xs text-muted-foreground">
            {t("positionResultHint")}
          </span>
        </div>
        <Amount
          minorUnits={position.minorUnits}
          currency={currency}
          display="code"
          signDisplay="exceptZero"
          className={cn(
            "text-base font-semibold",
            result > 0n && "text-positive",
            result < 0n && "text-negative",
            result === 0n && "text-neutral-balance",
          )}
        />
      </div>
    </div>
  );
}
