import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatMoney, money } from "@/modules/currencies/money";
import { ArrowDownLeft, ArrowUpRight, Minus } from "lucide-react";

/**
 * Money display primitives.
 *
 * Amounts arrive from Server Components as decimal strings of minor units —
 * never as JS numbers — and are formatted through Intl here, in the active
 * locale: the same balance reads "€1,234.56" in English and "1 234,56 €" in
 * French, from one code path.
 *
 * Balance colour is never the only signal: every balance also carries a word
 * ("owes" / "gets back" / "settled") and an icon, so the meaning survives
 * greyscale, colour blindness and a screen reader.
 *
 * `useLocale`/`useTranslations` resolve in both Server and Client Components,
 * so these primitives stay usable from either without a "use client" split.
 */

export function Amount({
  minorUnits,
  currency,
  className,
  display = "symbol",
  signDisplay,
}: {
  minorUnits: string;
  currency: string;
  className?: string;
  display?: "symbol" | "code" | "none";
  signDisplay?: Intl.NumberFormatOptions["signDisplay"];
}) {
  const locale = useLocale();
  const value = money(BigInt(minorUnits), currency);
  return (
    <span className={cn("tabular-nums", className)}>
      {formatMoney(value, { locale, display, signDisplay })}
    </span>
  );
}

export type BalanceTone = "positive" | "negative" | "neutral";

export function toneFor(minorUnits: string): BalanceTone {
  const value = BigInt(minorUnits);
  if (value > 0n) return "positive";
  if (value < 0n) return "negative";
  return "neutral";
}

const TONE_STYLES: Record<BalanceTone, string> = {
  positive: "text-positive",
  negative: "text-negative",
  neutral: "text-neutral-balance",
};

/** Message keys in the `money` namespace, resolved at render time. */
const TONE_LABEL_KEYS = {
  positive: "getsBack",
  negative: "owes",
  neutral: "settledUp",
} as const;

const TONE_ICONS: Record<BalanceTone, typeof ArrowDownLeft> = {
  positive: ArrowDownLeft,
  negative: ArrowUpRight,
  neutral: Minus,
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
}: {
  minorUnits: string;
  currency: string;
  className?: string;
  showLabel?: boolean;
  size?: "default" | "large" | "small";
}) {
  const locale = useLocale();
  const t = useTranslations("money");
  const tone = toneFor(minorUnits);
  const Icon = TONE_ICONS[tone];
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
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="tabular-nums">
        {formatMoney(money(magnitude, currency), { locale })}
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
export function SettledBadge({ className }: { className?: string }) {
  const t = useTranslations("money");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-neutral-balance",
        className,
      )}
    >
      <Minus aria-hidden="true" className="size-4" />
      {t("settledUpBadge")}
    </span>
  );
}
