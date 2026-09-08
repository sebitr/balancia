"use client";

import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { ExchangeRateField } from "@/components/money/exchange-rate-field";
import { cn } from "@/lib/utils";
import { currencyEntry } from "@/modules/currencies/catalog";
import { convertMoney, formatMoney, money } from "@/modules/currencies/money";
import { parseAmountToMinor } from "@/components/expenses/expense-form-logic";
import { FIGURE_MAX_PX, useFittedFigure } from "./figure-fit";

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
 * The figure's type, shared by the field, the sign in front of it and the
 * invisible copy they are measured against, so all three sit on one baseline.
 *
 * Every size but the tracking is here; the size itself is set inline, because
 * it is whatever fits — `figure-fit.ts` says how, and why it can never land
 * under the 16px that makes iOS zoom the page in.
 */
const FIGURE = "leading-none font-semibold tracking-[-0.03em] tabular-nums";

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
  /** Raw field text; the caller runs it through `sanitiseAmount`. */
  onAmountChange: (next: string) => void;
  onOpenCurrency: () => void;
  locale: string;
}) {
  const t = useTranslations("addEntry.amount");

  const { size, chipSize, fieldRef, mirrorRef, chipRef } =
    useFittedFigure(amountText);
  const empty = amountText === "" || Number.parseFloat(amountText) === 0;
  const flag = currencyEntry(currency, locale)?.flag;
  const parsed = parseAmountToMinor(amountText || "0", currency);
  const converted =
    needsRate && baseCurrency && parsed.ok && rate.trim() !== ""
      ? convert(parsed.value, rate, currency, baseCurrency, locale)
      : null;

  return (
    <div className="space-y-3 rounded-[17px] bg-card p-4 shadow-hairline">
      <span className="block text-xs font-medium text-muted-foreground">
        {label}
      </span>

      {/* The figure and its currency on one line, because they are one value.
          The field takes the room that is left rather than the room it wants,
          so a six-figure amount pushes nothing off the card — and the figure
          is drawn at whatever size that room allows, so it is never the field
          that decides how much of the amount a reader gets to see. */}
      <div className="relative flex min-h-12 w-full items-center gap-3">
        {/* The sign belongs to the figure, not to the value: it is never typed
            and must never come back out of the field. It takes the fitted size
            too, or a shrunk amount would be signed in type a third larger. */}
        {positive && !empty && (
          <span
            aria-hidden="true"
            style={{ fontSize: size }}
            className={cn(FIGURE, "text-positive-ink")}
          >
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
          // How the drawer finds the field to open on. Marked here rather than
          // handed down as a ref, because the thing that needs naming is which
          // field a reader starts in, and that is a fact about this card.
          data-entry-amount=""
          ref={fieldRef}
          style={{ fontSize: size }}
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
            "min-w-0 flex-1 bg-transparent caret-primary outline-none placeholder:text-muted-foreground/60",
            positive ? "text-positive-ink" : "text-foreground",
          )}
        />

        {/* The same text, at full size, where nobody can see it: the width the
            figure would want if it had the room, which is what the field's own
            width is measured against.

            The box around it is nothing at all — no size, and clipped — so a
            twelve-character amount cannot reach past the card and put a
            horizontal scrollbar on the sheet. The span inside keeps its
            natural width all the same, which is the width being read. */}
        <span
          aria-hidden="true"
          className="invisible absolute top-0 left-0 size-0 overflow-hidden"
        >
          <span
            ref={mirrorRef}
            style={{ fontSize: FIGURE_MAX_PX }}
            className={cn(FIGURE, "inline-block whitespace-pre")}
          >
            {amountText}
          </span>
        </span>

        {/* Always a chip that opens the list, repayments included. A
            settlement usually is denominated by the debt it clears — which is
            what picking one off the outstanding list already fills in — but
            "usually" was being enforced as "only": money handed back in cash
            on the trip, in the currency that was to hand, had no way to be
            recorded as what it was. */}
        <button
          type="button"
          onClick={onOpenCurrency}
          ref={chipRef}
          // The code is read together with the figure beside it, so it is
          // sized to be read from the same distance — the top of the scale
          // rather than the bottom of it, and the chip grown to hold it. When
          // the figure has to shrink the chip goes with it, and `tap-target`
          // keeps the finger its 44px however small the pill is drawn.
          style={{ fontSize: chipSize }}
          // Every length in the pill is in `em`, so the one size carries the
          // whole of it: 2em is the 48px it stands at beside a full-size
          // figure, 0.583em the 14px of padding, 0.333em the 8px between flag,
          // code and chevron.
          className="tap-target inline-flex h-[2em] shrink-0 items-center gap-[0.333em] rounded-full border border-border bg-wash-2 px-[0.583em] leading-none font-semibold tracking-[-0.02em] whitespace-nowrap transition-colors active:bg-wash-4"
        >
          {flag && (
            <span aria-hidden="true" className="text-[0.833em] leading-none">
              {flag}
            </span>
          )}
          {currency}
          <ChevronDown aria-hidden="true" className="size-[0.75em]" />
        </button>
      </div>

      {needsRate && baseCurrency && (
        <div className="space-y-2 rounded-[14px] border border-border bg-muted p-3.5">
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
            <div className="flex items-center justify-between gap-3 border-t border-border pt-2.5">
              <span className="text-xs text-muted-foreground">
                {t("inBaseCurrency")}
              </span>
              <span className="text-sm font-semibold tabular-nums">
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
