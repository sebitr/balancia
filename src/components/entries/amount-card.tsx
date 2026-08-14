"use client";

import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { ExchangeRateField } from "@/components/money/exchange-rate-field";
import { cn } from "@/lib/utils";
import { convertMoney, formatMoney, money } from "@/modules/currencies/money";
import { parseAmountToMinor } from "@/components/expenses/expense-form-logic";

/**
 * The amount, and everything that qualifies it.
 *
 * The figure is a button, not an input: tapping it opens the pad. That keeps
 * one code path for entering an amount instead of two that drift — a native
 * keyboard on desktop and a pad on mobile would eventually disagree about what
 * "1.2.3" means.
 *
 * When the currency is not the group's, the rate block appears *inside* this
 * card rather than below it, because the rate is part of what the amount means
 * and not a separate question.
 */

export function AmountCard({
  label,
  amountText,
  currency,
  baseCurrency,
  needsRate,
  rate,
  onRateChange,
  date,
  positive = false,
  editable = true,
  currencyLocked = false,
  onOpenKeypad,
  onOpenCurrency,
  caret = false,
  locale,
}: {
  label: string;
  amountText: string;
  currency: string;
  /** The group's base currency, when it converts. */
  baseCurrency: string | null;
  needsRate: boolean;
  rate: string;
  onRateChange: (next: string) => void;
  /** Day the rate applies to, `YYYY-MM-DD`. */
  date: string;
  /** Income is green. */
  positive?: boolean;
  editable?: boolean;
  /** A settlement is pinned to the base currency; the chip becomes a label. */
  currencyLocked?: boolean;
  onOpenKeypad: () => void;
  onOpenCurrency: () => void;
  /** Blinks only while the pad is open, so it never claims a focus it lacks. */
  caret?: boolean;
  locale: string;
}) {
  const t = useTranslations("addEntry.amount");

  const empty = amountText === "" || Number.parseFloat(amountText) === 0;
  const parsed = parseAmountToMinor(amountText || "0", currency);
  const converted =
    needsRate && baseCurrency && parsed.ok && rate.trim() !== ""
      ? convert(parsed.value, rate, currency, baseCurrency, locale)
      : null;

  return (
    <div className="space-y-4 rounded-[17px] bg-card p-4 shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted-foreground">
          {label}
        </span>
        {currencyLocked ? (
          <span className="inline-flex h-8 items-center rounded-[10px] px-2.5 text-[13px] font-semibold text-muted-foreground">
            {currency}
          </span>
        ) : (
          <button
            type="button"
            onClick={onOpenCurrency}
            className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-white/14 bg-white/8 px-2.5 text-[13px] font-semibold transition-colors active:bg-white/14"
          >
            {currency}
            <ChevronDown aria-hidden="true" className="size-[13px]" />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onOpenKeypad}
        disabled={!editable}
        aria-label={label}
        className="flex w-full items-center text-left disabled:pointer-events-none"
      >
        <span
          className={cn(
            "text-[44px] leading-none font-semibold tracking-[-0.03em] tabular-nums",
            empty
              ? "text-muted-foreground/60"
              : positive
                ? "text-positive"
                : "text-foreground",
          )}
        >
          {positive && !empty && "+"}
          {amountText === "" ? t("zero") : amountText}
        </span>
        {caret && (
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block h-9 w-0.5 animate-[caret_1.1s_steps(1,end)_infinite] bg-primary"
          />
        )}
      </button>

      {needsRate && baseCurrency && (
        <div className="space-y-2 rounded-[14px] border border-primary/35 bg-primary/10 p-3.5">
          <ExchangeRateField
            id="entry-rate"
            from={currency}
            to={baseCurrency}
            on={date}
            value={rate}
            onChange={onRateChange}
            hint={t("rateFrozen")}
          />
          {converted && (
            <div className="flex items-center justify-between gap-3 border-t border-white/12 pt-2.5">
              <span className="text-[13px] text-muted-foreground">
                {t("inBaseCurrency")}
              </span>
              <span className="text-[15px] font-semibold tabular-nums">
                {converted}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The same total, in the group's currency.
 *
 * Goes through the domain's own `convertMoney` rather than multiplying here:
 * it scales between currencies whose minor units differ — €10.00 into yen is
 * 1300, not 130000 — and it stays in bigint, which a float multiply would not.
 *
 * A preview only. The authoritative conversion is redone server-side and
 * frozen with the entry, so a rate that moves between typing and saving cannot
 * change what was recorded.
 */
function convert(
  minor: bigint,
  rate: string,
  from: string,
  to: string,
  locale: string,
): string | null {
  try {
    return formatMoney(convertMoney(money(minor, from), to, rate.trim()), {
      locale,
    });
  } catch {
    // Half-typed rates ("1.", "0") throw; the line simply waits.
    return null;
  }
}
