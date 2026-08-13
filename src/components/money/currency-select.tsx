"use client";

import { useTranslations } from "next-intl";
import { SUPPORTED_CURRENCIES } from "@/modules/currencies/iso-4217";
import { cn } from "@/lib/utils";

/**
 * Currency picker.
 *
 * A native <select> on purpose: ~160 options, and the platform's own picker is
 * faster and more accessible on a phone than any custom listbox. Common
 * currencies are grouped first so the usual choice is one tap away.
 */

const COMMON = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "JPY",
  "CAD",
  "AUD",
  "SEK",
  "NOK",
  "DKK",
];

export function CurrencySelect({
  id,
  name,
  defaultValue = "EUR",
  value,
  onChange,
  required,
  className,
  disabled,
}: {
  id?: string;
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("money");
  const common = SUPPORTED_CURRENCIES.filter((currency) =>
    COMMON.includes(currency.code),
  ).sort((a, b) => COMMON.indexOf(a.code) - COMMON.indexOf(b.code));
  const rest = SUPPORTED_CURRENCIES.filter(
    (currency) => !COMMON.includes(currency.code),
  );

  return (
    <select
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      defaultValue={value === undefined ? defaultValue : undefined}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <optgroup label={t("commonCurrencies")}>
        {common.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.code} — {currency.name}
          </option>
        ))}
      </optgroup>
      <optgroup label={t("allCurrencies")}>
        {rest.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.code} — {currency.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
