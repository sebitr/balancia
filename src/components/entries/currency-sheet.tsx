"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { SUPPORTED_CURRENCIES } from "@/modules/currencies/iso-4217";

/**
 * Picking the currency an entry was actually paid in.
 *
 * A searchable list rather than the native `<select>` used elsewhere, because
 * this sheet sits inside another sheet's worth of context — the amount is
 * still on screen behind it — and a native picker would take the whole
 * viewport and lose that. Search matches the code or the name, so both "CHF"
 * and "franc" get there.
 *
 * The group's own currency is named at the top: it is the one people convert
 * *to*, and knowing it is what makes choosing another one meaningful.
 *
 * Everything but the list is `shrink-0`. Typing in the search field opens a
 * keyboard, the sheet above shortens itself to sit on top of it, and the only
 * part that may lose height for that is the list — never the field being typed
 * into or the Done button under it.
 */

export function CurrencySheet({
  value,
  baseCurrency,
  onSelect,
  onDone,
}: {
  value: string;
  baseCurrency: string | null;
  onSelect: (code: string) => void;
  onDone: () => void;
}) {
  const t = useTranslations("addEntry.currency");
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return SUPPORTED_CURRENCIES;
    return SUPPORTED_CURRENCIES.filter(
      (currency) =>
        currency.code.toLowerCase().includes(needle) ||
        currency.name.toLowerCase().includes(needle),
    );
  }, [query]);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <SheetTitle className="text-[19px] font-semibold tracking-[-0.02em]">
          {t("title")}
        </SheetTitle>
        {baseCurrency && (
          <span className="text-[13px] text-muted-foreground">
            {t("groupBase", { currency: baseCurrency })}
          </span>
        )}
      </div>

      <div className="relative shrink-0">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          className="h-11 pl-9"
        />
      </div>

      <ul className="-mx-1 max-h-[46vh] min-h-0 flex-auto overflow-y-auto px-1">
        {matches.map((currency) => {
          const active = currency.code === value;
          return (
            <li key={currency.code}>
              <button
                type="button"
                onClick={() => onSelect(currency.code)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors active:bg-accent",
                  active && "bg-accent",
                )}
              >
                <span className="w-11 shrink-0 text-[13px] font-semibold">
                  {currency.code}
                </span>
                <span className="flex-1 truncate text-sm text-muted-foreground">
                  {currency.name}
                </span>
                {active && (
                  <Check aria-hidden="true" className="size-4 text-primary" />
                )}
              </button>
            </li>
          );
        })}
        {matches.length === 0 && (
          <li className="px-2.5 py-6 text-center text-sm text-muted-foreground">
            {t("noMatch")}
          </li>
        )}
      </ul>

      <Button
        type="button"
        size="lg"
        className="h-13 shrink-0"
        onClick={onDone}
      >
        {t("done")}
      </Button>
    </div>
  );
}
