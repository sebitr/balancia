"use client";

import { useTranslations } from "next-intl";
import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { currencyExponent } from "@/modules/currencies/iso-4217";
import { pressKey, type KeypadKey } from "./entry-logic";

/**
 * The amount pad.
 *
 * A pad rather than a text input because this is the one field on the screen
 * that is always numeric, always the first thing typed, and always typed with
 * a thumb. A native keyboard would cover the amount it is editing; this does
 * not, and the live figure stays visible in the header while it changes.
 *
 * Which keys exist is decided by the currency: a currency with no minor unit
 * gets no decimal point at all, rather than one that silently does nothing.
 */

const DIGITS: readonly KeypadKey[] = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
];

export function KeypadSheet({
  label,
  value,
  currency,
  positive,
  onChange,
  onDone,
}: {
  /** Repeats the field's own label, so the sheet is not context-free. */
  label: string;
  value: string;
  currency: string;
  /** Income shows its amount in green here too. */
  positive?: boolean;
  onChange: (next: string) => void;
  onDone: () => void;
}) {
  const t = useTranslations("addEntry.keypad");
  const hasDecimals = currencyExponent(currency) > 0;

  const press = (key: KeypadKey) => onChange(pressKey(value, key, currency));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-muted-foreground">
          {label}
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">
            {currency}
          </span>
          <span
            className={cn(
              "text-[22px] font-semibold tabular-nums",
              positive ? "text-positive" : "text-foreground",
            )}
          >
            {value === "" ? t("zero") : value}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {DIGITS.map((digit) => (
          <Key key={digit} onPress={() => press(digit)}>
            {digit}
          </Key>
        ))}
        <Key onPress={() => press(".")} disabled={!hasDecimals}>
          .
        </Key>
        <Key onPress={() => press("0")}>0</Key>
        <Key onPress={() => press("delete")} muted label={t("delete")}>
          <Delete aria-hidden="true" className="size-[18px]" />
        </Key>
      </div>

      <Button type="button" size="lg" className="h-13" onClick={onDone}>
        {t("done")}
      </Button>
    </div>
  );
}

function Key({
  children,
  onPress,
  muted = false,
  disabled = false,
  label,
}: {
  children: React.ReactNode;
  onPress: () => void;
  /** The delete key is drawn without a fill, so it reads as the odd one out. */
  muted?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "flex h-[54px] items-center justify-center rounded-xl border border-white/12 text-[22px] font-medium transition-colors active:bg-white/12 disabled:pointer-events-none disabled:opacity-30",
        muted ? "bg-transparent" : "bg-white/6",
      )}
    >
      {children}
    </button>
  );
}
