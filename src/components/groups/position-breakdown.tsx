"use client";

import { useId, useState } from "react";
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

/**
 * Why the reader's balance is what it is, said in sentences.
 *
 * Somebody taps "How this is calculated" because the figure in the hero did
 * not make sense to them. This used to answer with three collapsed rows named
 * like ledger accounts — "Expenses + EUR 60.00" to a reader who had spent
 * ninety — and kept the one sentence that explained it behind a tap. Now the
 * sheet opens on the explanation itself: what you paid, what your share was,
 * any income and any repayment, and then the result with its word, in its
 * tone. Each of those is one whole message, chosen by case, so a translator
 * never has to stitch a sentence back together.
 *
 * Nothing whose amount is zero is said. "You received EUR 0.00 of the group's
 * income" is a sentence about something that did not happen, and in most
 * groups income and repayments never do. Only the opening sentence about
 * expenses is always there, because it is where the reader's question starts.
 *
 * The ledger is still here for whoever wants the arithmetic, behind one
 * disclosure under the result: every figure in it has already been said
 * above, so nothing the reader needs is hidden by keeping it shut.
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
  const locale = useNumberLocale();
  const [figuresOpen, setFiguresOpen] = useState(false);
  const figuresId = useId();

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
    formatMoney(money(amount < 0n ? -amount : amount, currency), {
      locale,
      display: "code",
    });

  const sentences: { key: string; text: string }[] = [];

  // Expenses open the account whatever they hold. A reader with no share in
  // any of them is told so, because that is the part of the answer they would
  // otherwise go looking for. Under a currency heading the sentence names the
  // currency: the reader is very likely part of the group's other expenses.
  sentences.push({
    key: "expenses",
    text:
      paid === 0n && share === 0n
        ? showCurrency
          ? t("explainNoExpensesIn", { currency })
          : t("explainNoExpenses")
        : paid === share
          ? t("explainPaidExactlyShare", { paid: inline(paid) })
          : paid === 0n
            ? t("explainPaidNothing", { share: inline(share) })
            : share === 0n
              ? t("explainPaidForOthers", { paid: inline(paid) })
              : t("explainPaidAndShare", {
                  paid: inline(paid),
                  share: inline(share),
                }),
  });

  if (revenueReceived !== 0n || revenueCredited !== 0n) {
    sentences.push({
      key: "income",
      text:
        revenueCredited === 0n
          ? t("explainIncomeForOthers", { received: inline(revenueReceived) })
          : revenueReceived === 0n
            ? t("explainIncomeShareOnly", {
                credited: inline(revenueCredited),
              })
            : t("explainIncome", {
                received: inline(revenueReceived),
                credited: inline(revenueCredited),
              }),
    });
  }

  if (settlementsPaid !== 0n) {
    sentences.push({
      key: "paidBack",
      text: t("explainPaidBack", { amount: inline(settlementsPaid) }),
    });
  }

  if (settlementsReceived !== 0n) {
    sentences.push({
      key: "beenPaidBack",
      text: t("explainBeenPaidBack", { amount: inline(settlementsReceived) }),
    });
  }

  // Zero for every entry kind that exists today; said if it ever is not, or
  // the sentences above would stop adding up to the result below.
  if (otherAdjustments !== 0n) {
    sentences.push({
      key: "other",
      text:
        otherAdjustments > 0n
          ? t("explainAdjustmentUp", { amount: inline(otherAdjustments) })
          : t("explainAdjustmentDown", { amount: inline(otherAdjustments) }),
    });
  }

  const tone = toneFor(result);
  const conclusion =
    tone === "positive"
      ? t("explainGetBack", { amount: inline(result) })
      : tone === "negative"
        ? t("explainOwe", { amount: inline(result) })
        : t("explainSettled");

  // The ledger, for whoever wants the arithmetic. A row whose amount is zero
  // is left out like the sentence it would have stood for, and a section left
  // with no rows goes with it.
  const sections = [
    {
      key: "expenses",
      title: t("positionSectionExpenses"),
      subtotal: paid - share,
      rows: [
        { key: "paid", label: t("positionYouPaid"), value: paid },
        { key: "share", label: t("positionYourShare"), value: share },
      ],
    },
    {
      key: "income",
      title: t("positionSectionRevenue"),
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
      key: "repayments",
      title: t("positionSectionSettlements"),
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
  ]
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => row.value !== 0n),
    }))
    .filter((section) => section.rows.length > 0);

  const hasFigures = sections.length > 0 || otherAdjustments !== 0n;

  return (
    <div className="flex flex-col gap-2.5">
      {showCurrency && (
        <CurrencyHeading as="h3" currency={currency} className="px-1" />
      )}

      <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
        <div className="flex flex-col gap-2 px-3.5 py-3">
          {sentences.map((sentence) => (
            <p key={sentence.key} className="text-sm text-pretty">
              {sentence.text}
            </p>
          ))}
        </div>
        {/* The answer, with its word and in its tone, never a bare signed
            figure: the sign was what the reader could not read to begin
            with. */}
        <p
          className={cn(
            "border-t bg-muted px-3.5 py-3 text-base font-semibold text-pretty",
            TONE[tone].ink,
          )}
        >
          {conclusion}
        </p>
      </div>

      {hasFigures && (
        <>
          <button
            type="button"
            aria-expanded={figuresOpen}
            aria-controls={figuresId}
            onClick={() => setFiguresOpen((wasOpen) => !wasOpen)}
            className="-mx-1 flex min-h-11 items-center gap-[7px] self-start rounded-lg px-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-[13px] shrink-0 transition-transform duration-150 motion-reduce:transition-none",
                figuresOpen ? "rotate-0" : "-rotate-90",
              )}
            />
            {t("positionFigures")}
          </button>

          {figuresOpen && (
            <div
              id={figuresId}
              className="rounded-2xl bg-card px-3.5 ring-1 ring-border"
            >
              {sections.map((section) => (
                <dl
                  key={section.key}
                  className="border-t py-1.5 first:border-t-0"
                >
                  {/* The subtotal is the one signed figure in a section: it
                      is the section's effect on the balance. The totals under
                      it are amounts, and carry no sign. */}
                  <div className="flex min-h-9 items-center justify-between gap-4">
                    <dt className="text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                      {section.title}
                    </dt>
                    <dd>
                      <Amount
                        minorUnits={section.subtotal.toString()}
                        currency={currency}
                        display="code"
                        signDisplay="exceptZero"
                        className="text-xs font-semibold"
                      />
                    </dd>
                  </div>
                  {section.rows.map((row) => (
                    <div
                      key={row.key}
                      className="flex min-h-11 items-center justify-between gap-4"
                    >
                      <dt className="text-sm text-muted-foreground">
                        {row.label}
                      </dt>
                      <dd className="text-sm font-medium">
                        <Amount
                          minorUnits={row.value.toString()}
                          currency={currency}
                          display="code"
                        />
                      </dd>
                    </div>
                  ))}
                </dl>
              ))}

              {otherAdjustments !== 0n && (
                <dl className="border-t py-1.5 first:border-t-0">
                  <div className="flex min-h-11 items-center justify-between gap-4">
                    <dt className="text-sm text-muted-foreground">
                      {t("positionOtherAdjustments")}
                    </dt>
                    <dd className="text-sm font-medium">
                      <Amount
                        minorUnits={otherAdjustments.toString()}
                        currency={currency}
                        display="code"
                        signDisplay="exceptZero"
                      />
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
