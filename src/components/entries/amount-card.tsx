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
 * The figure is a real text input with `inputMode="decimal"`, so the platform
 * brings up its own numeric keyboard — the one with the caret, the repeating
 * backspace, the paste menu and the layout a thumb already knows. An in-app
 * pad had to reimplement every one of those, and each round trip through
 * React to repaint a digit is a frame a native keyboard does not spend.
 *
 * There is still only one code path for what an amount *is*: whatever the
 * keyboard produces goes through `sanitiseAmount`, so a comma, a paste and a
 * held-down `9` all end up under the same currency-aware rules.
 *
 * When the currency is not the group's, the rate block appears *inside* this
 * card rather than below it, because the rate is part of what the amount means
 * and not a separate question.
 */

/**
 * The figure's type, shared by the field and the sign in front of it so the
 * two sit on one baseline. The size is also what stops iOS zooming the page in
 * when the field takes focus, which anything under 16px would.
 */
const FIGURE =
  "text-[44px] leading-none font-semibold tracking-[-0.03em] tabular-nums";

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
  onAmountChange,
  onOpenCurrency,
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
  /** Raw field text; the caller runs it through `sanitiseAmount`. */
  onAmountChange: (next: string) => void;
  onOpenCurrency: () => void;
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

      <div className="flex w-full items-center">
        {/* The sign belongs to the figure, not to the value: it is never typed
            and must never come back out of the field. */}
        {positive && !empty && (
          <span aria-hidden="true" className={cn(FIGURE, "text-positive")}>
            +
          </span>
        )}
        <input
          // Not `type="number"`: it brings spinners, refuses a partly-typed
          // "84.", and reads back "" for anything it dislikes — which would
          // throw away what somebody was in the middle of writing.
          type="text"
          inputMode="decimal"
          enterKeyHint="done"
          value={amountText}
          onChange={(event) => onAmountChange(event.target.value)}
          // Nothing to submit — the entry is saved from its own button — so
          // the keyboard's Done key just puts the keyboard away.
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          readOnly={!editable}
          aria-label={label}
          placeholder={t("zero")}
          autoComplete="off"
          className={cn(
            FIGURE,
            "w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground/60",
            positive ? "text-positive" : "text-foreground",
          )}
        />
      </div>

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
