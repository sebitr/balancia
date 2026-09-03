"use client";

import { useTranslations } from "next-intl";
import { TONE, toneFor } from "@/components/money/balance-tone";
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

/**
 * The sign a figure carries, in the app's own hand rather than Intl's.
 *
 * Intl writes "-CHF 961": an ASCII hyphen, flush against the code. Every
 * balance the app draws itself — the dashboard rows, the entry detail, the
 * settle screen — writes "− CHF 961": a real minus, then a space, then the
 * figure, with a matching "+" on the other side. Both stood on one screen,
 * the hero in one hand and the list under it in the other, so the sign is
 * decided here for every figure that asks for one, and Intl only ever sees
 * the magnitude.
 *
 * The vocabulary is Intl's own `signDisplay`, so a call site reads as it
 * did: `exceptZero` signs both directions and leaves zero bare, `always`
 * signs zero too, `never` shows nothing, and the default signs a loss only.
 * The space is non-breaking, so a line never ends on a bare sign.
 */
const SPACE = "\u00A0";

function signFor(
  minorUnits: bigint,
  signDisplay: Intl.NumberFormatOptions["signDisplay"],
): "+" | "−" | null {
  if (signDisplay === "never") return null;
  if (minorUnits < 0n) return TONE.negative.sign;
  if (minorUnits > 0n) {
    return signDisplay === "always" || signDisplay === "exceptZero"
      ? TONE.positive.sign
      : null;
  }
  return signDisplay === "always" ? TONE.positive.sign : null;
}

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
  const signed = BigInt(minorUnits);
  const sign = signFor(signed, signDisplay);
  const magnitude = signed < 0n ? -signed : signed;
  const figure = formatMoney(money(magnitude, currency), {
    locale,
    display,
    fractionDigits,
  });
  return (
    <span className={cn("tabular-nums", className)}>
      {sign ? `${sign}${SPACE}${figure}` : figure}
    </span>
  );
}

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
  const sign = TONE[tone].sign;
  const label = t(TONE[tone].labelKey);
  const magnitude =
    BigInt(minorUnits) < 0n ? -BigInt(minorUnits) : BigInt(minorUnits);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-medium",
        TONE[tone].ink,
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
