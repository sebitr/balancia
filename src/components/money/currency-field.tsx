"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { openOnContent, Sheet, SheetContent } from "@/components/ui/sheet";
import { CurrencyPicker } from "@/components/money/currency-picker";
import { currencyEntry } from "@/modules/currencies/catalog";
import { cn } from "@/lib/utils";

/**
 * A currency, as one row of an ordinary form.
 *
 * The picker is a full-height view and most of the app's currency questions
 * are one field among eight — so this is what stands in for it there: the
 * chosen currency, shown the way the list shows it, and a sheet that opens on
 * the list when it is pressed.
 *
 * The form sheets that have a second screen of their own — the group form, the
 * entry drawer — do not use this. They swap their own content for
 * `CurrencyPicker` instead, because a sheet opening on top of a sheet is a
 * modal on a modal, and the design says plainly that it is not one.
 */
export function CurrencyField({
  id,
  name,
  value,
  onChange,
  /** Names the picker once it is open; defaults to "Currency". */
  label,
  disabled,
  className,
}: {
  id?: string;
  /** Submits with the surrounding form, for the call sites that post one. */
  name?: string;
  value: string;
  onChange: (code: string) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations("currencyPicker");
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  const entry = currencyEntry(value, locale);
  const title = label ?? t("fieldLabel");

  return (
    <>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={t("fieldValue", { code: value, name: entry?.name ?? "" })}
        className={cn(
          "tap-target flex h-9 w-full items-center gap-2.5 rounded-md border border-input bg-background px-3 py-1 text-left text-sm shadow-xs ring-offset-background transition-colors duration-150 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span aria-hidden="true" className="text-base leading-none">
          {entry?.flag}
        </span>
        <span className="font-semibold tracking-[0.01em]">{value}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {entry?.name}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      </button>

      {name && <input type="hidden" name={name} value={value} />}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          // Opening on the search field would put a keyboard over the
          // favourites the sheet exists to show. Same reason as every other
          // sheet in the app that leads with a field.
          onOpenAutoFocus={openOnContent}
          className="h-[min(800px,calc(100dvh-48px-env(safe-area-inset-top)))] max-h-[calc(100%-48px-env(safe-area-inset-top))] gap-0 overflow-hidden rounded-t-[28px] bg-card pt-2.5 text-card-foreground"
        >
          <CurrencyPicker
            value={value}
            title={title}
            onSelect={(code) => {
              onChange(code);
              setOpen(false);
            }}
            onBack={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
