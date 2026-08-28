"use client";

import { useTranslations } from "next-intl";
import { toneFor, type BalanceTone } from "@/components/money/balance-tone";
import { cn } from "@/lib/utils";
import { useNumberLocale } from "@/i18n/format-context";
import { formatMoney, money } from "@/modules/currencies/money";

/**
 * Money display primitives.
 *
 * Amounts arrive from Server Components as decimal strings of minor units —
 * never as JS numbers — and are formatted through Intl here, in the notation
 * the reader chose: the same balance reads "€1,234.56" or "1 234,56 €" from
 * one code path.
 *
 * Balance colour is never the only signal: every balance also carries a word
 * ("owes" / "gets back" / "settled") and an icon, so the meaning survives
 * greyscale, colour blindness and a screen reader.
 *
 * These render on the client so they can read that notation from context,
 * which a Server Component cannot subscribe to. They stay leaves either way:
 * every prop is a plain string, so a server page renders them without becoming
 * a client tree itself.
 */

export function Amount({
  minorUnits,
  currency,
  className,
  display = "symbol",
  signDisplay,
  fractionDigits,
}: {
  minorUnits: string;
  currency: string;
  className?: string;
  display?: "symbol" | "code" | "none";
  signDisplay?: Intl.NumberFormatOptions["signDisplay"];
  /** Digits after the separator; defaults to the currency's own precision. */
  fractionDigits?: number;
}) {
  const locale = useNumberLocale();
  const value = money(BigInt(minorUnits), currency);
  return (
    <span className={cn("tabular-nums", className)}>
      {formatMoney(value, { locale, display, signDisplay, fractionDigits })}
    </span>
  );
}

const TONE_STYLES: Record<BalanceTone, string> = {
  positive: "text-positive-ink",
  negative: "text-negative-ink",
  neutral: "text-neutral-balance-ink",
};

/** Message keys in the `money` namespace, resolved at render time. */
const TONE_LABEL_KEYS = {
  positive: "getsBack",
  negative: "owes",
  neutral: "settledUp",
} as const;

const TONE_SIGNS: Record<BalanceTone, string> = {
  positive: "+",
  negative: "−",
  neutral: "−",
};

/**
 * A participant balance rendered with all three redundant cues: wording,
 * icon and colour.
 */
export function BalanceAmount({
  minorUnits,
  currency,
  className,
  showLabel = true,
  size = "default",
  fractionDigits,
}: {
  minorUnits: string;
  currency: string;
  className?: string;
  showLabel?: boolean;
  size?: "default" | "large" | "small";
  /** Digits after the separator; defaults to the currency's own precision. */
  fractionDigits?: number;
}) {
  const locale = useNumberLocale();
  const t = useTranslations("money");
  const tone = toneFor(minorUnits);
  const sign = TONE_SIGNS[tone];
  const label = t(TONE_LABEL_KEYS[tone]);
  const magnitude =
    BigInt(minorUnits) < 0n ? -BigInt(minorUnits) : BigInt(minorUnits);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-medium",
        TONE_STYLES[tone],
        size === "large" && "text-xl font-semibold",
        size === "small" && "text-sm",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="w-4 shrink-0 text-center leading-none font-semibold"
      >
        {sign}
      </span>
      <span className="tabular-nums">
        {formatMoney(money(magnitude, currency), { locale, fractionDigits })}
      </span>
      {showLabel && (
        <span className="text-sm font-normal text-muted-foreground">
          {label}
        </span>
      )}
      {/* Redundant text for assistive technology when the label is hidden. */}
      {!showLabel && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** A settled/zero state, phrased rather than shown as "0.00". */
