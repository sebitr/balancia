"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { openOnContent, Sheet, SheetContent } from "@/components/ui/sheet";
import { CurrencyPicker } from "@/components/money/currency-picker";
import { toastUndoable } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { useFormatPreferences } from "@/i18n/format-context";
import {
  createDateFormatter,
  DATE_FORMATS,
  dateFormatSample,
  numberFormatSample,
  numberLocale,
  NUMBER_FORMATS,
} from "@/i18n/format";
import { formatMoney } from "@/modules/currencies/money";
import {
  setFormatPreferencesAction,
  setPreferredCurrencyAction,
} from "@/modules/profile/actions";

/**
 * Notation, shown rather than named.
 *
 * Eight rows reading "dmy", "mdy", "comma-dot" were eight ways of describing
 * two decisions nobody has words for. So the screen is one line of the
 * reader's own money — their last entry, its real title and its real amount —
 * and two rows of chips underneath that rewrite it as they are pressed. The
 * question stops being "what is space-comma?" and becomes "which of these do I
 * want", which is a question anybody can answer at a glance.
 *
 * That is why the preview and the chips are one component: the preview has to
 * change on the tap, not on the round trip, so both read the same local state
 * and the server catches up behind them.
 *
 * The display currency folds into the same card, because it is the third thing
 * that decides how the amount reads. Pressing it opens the app's own currency
 * picker — the same sheet with the same favourites and the same 165 currencies
 * that every other currency question opens, rather than a second list to keep
 * in step with the catalogue.
 */

export interface PreviewEntry {
  readonly description: string;
  /** Minor units, as text — never a JS number. */
  readonly amount: string;
  readonly currency: string;
  readonly expenseDate: string;
}

export function MoneyFormats({
  entry,
  converted,
  currency,
}: {
  /**
   * The reader's most recent entry, or null for an account that has none —
   * a first visit, or somebody who has only ever been left out of a split.
   * The card still renders, because it is also where the display currency is
   * chosen; it shows a worked example and says that is what it is.
   */
  entry: PreviewEntry | null;
  /**
   * The same amount in the display currency, or null when no rate could be
   * found — or when it is the same currency and there is nothing to convert.
   */
  converted: PreviewEntry | null;
  /** What the home screen totals in. */
  currency: string;
}) {
  const router = useRouter();
  const t = useTranslations("userSettings");
  const tCommon = useTranslations("common");
  const { dateFormat, numberFormat, formatLocale, timeZone } =
    useFormatPreferences();

  const [chosen, setChosen] = useState({ dateFormat, numberFormat });
  const [code, setCode] = useState(currency);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const locale = numberLocale(chosen.numberFormat, formatLocale);
  // Rebuilt on every chip press, which is the point: the line under the amount
  // has to be written in the notation that was just chosen, not the stored one.
  const dates = createDateFormatter({
    dateFormat: chosen.dateFormat,
    formatLocale,
    timeZone,
  });

  /** The example an account with no entries yet is shown. */
  const sample: PreviewEntry = {
    description: t("previewSampleTitle"),
    amount: "248000",
    currency: code,
    expenseDate: "2026-08-13",
  };
  const shown = entry ?? sample;

  const amountOf = (value: PreviewEntry) =>
    formatMoney(
      { amount: BigInt(value.amount), currency: value.currency },
      { locale, display: "none" },
    );

  /** `undo` names the row that changed, and is the toast it replaces. */
  const saveFormats = (
    next: typeof chosen,
    undo?: "dateFormat" | "numberFormat",
  ) => {
    const previous = chosen;
    setChosen(next);
    startTransition(async () => {
      const result = await setFormatPreferencesAction(next);
      if (!result.ok) {
        // Back to what is actually stored: a chip left showing a choice the
        // account did not keep is worse than no confirmation at all.
        setChosen(previous);
        toast.error(result.error ?? t("formatsFailed"));
        return;
      }
      if (undo) {
        toastUndoable(
          t("formatsSaved"),
          { label: tCommon("undo"), onUndo: () => saveFormats(previous) },
          { id: `format-${undo}` },
        );
      }
      // Every date and amount on the screens behind this one was written by
      // the server, in the notation that just changed.
      router.refresh();
    });
  };

  const saveCurrency = (next: string, announce = true) => {
    const previous = code;
    setCode(next);
    startTransition(async () => {
      const result = await setPreferredCurrencyAction(next);
      if (!result.ok) {
        setCode(previous);
        toast.error(result.error ?? t("currencyFailed"));
        return;
      }
      if (announce) {
        toastUndoable(
          t("currencySaved"),
          {
            label: tCommon("undo"),
            onUndo: () => saveCurrency(previous, false),
          },
          { id: "preferred-currency" },
        );
      }
      // The conversion under the amount is the server's answer, not ours.
      router.refresh();
    });
  };

  return (
    <>
      <section className="relative shrink-0 overflow-hidden rounded-[20px] bg-card ring-1 ring-foreground/10">
        {/* A wash of the accent from the top-left corner, so the card reads as
            the screen's subject rather than as the first of three panels. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 12% -20%, color-mix(in oklch, var(--primary) 26%, transparent), transparent 62%)",
          }}
        />

        <div className="relative flex flex-col gap-2.5 px-4 pt-3.5 pb-3">
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-full bg-primary/16 px-1.5 py-0.5 text-2xs font-bold tracking-[0.09em] text-primary-ink uppercase">
              {t("preview")}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {entry ? t("previewOfYours") : t("previewOfSample")}
            </span>
          </div>

          <p className="flex items-baseline gap-1.5">
            <span className="text-[34px] leading-none font-semibold tracking-[-0.025em] tabular-nums">
              {amountOf(shown)}
            </span>
            <span className="text-sm font-semibold text-muted-foreground">
              {shown.currency}
            </span>
          </p>

          <p className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="min-w-0 truncate font-medium">
              {shown.description}
            </span>
            <span aria-hidden="true" className="shrink-0 text-muted-foreground">
              ·
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {dates.plain(shown.expenseDate)}
            </span>
          </p>
        </div>

        <button
          type="button"
          disabled={isPending}
          onClick={() => setPickerOpen(true)}
          aria-haspopup="dialog"
          className="relative flex min-h-11 w-full items-center gap-2 border-t border-border px-4 py-2.5 text-left transition-colors hover:bg-foreground/4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
        >
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {t("currencyTitle")}
          </span>
          {converted && (
            <span className="shrink-0 text-xs tabular-nums">
              {/* The ≈ is doing real work: this figure came from today's rate
                  and will be a different number tomorrow. */}
              {shown.currency === converted.currency ? "" : "≈ "}
              {amountOf(converted)} {converted.currency}
            </span>
          )}
          <span className="shrink-0 rounded-full bg-primary/16 px-2 py-0.5 text-xs font-semibold text-primary-ink">
            {code}
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </button>
      </section>

      <ChipRow
        name="date-format"
        label={t("dates")}
        hint={chosen.dateFormat === "auto" ? t("followsBrowser") : null}
        value={chosen.dateFormat}
        disabled={isPending}
        choices={DATE_FORMATS.map((format) => ({
          value: format,
          label:
            format === "auto"
              ? t("formatAutoShort")
              : dateFormatSample(format, formatLocale),
        }))}
        onChoose={(next) =>
          saveFormats({ ...chosen, dateFormat: next }, "dateFormat")
        }
      />

      <ChipRow
        name="number-format"
        label={t("numbers")}
        hint={chosen.numberFormat === "auto" ? t("followsBrowser") : null}
        value={chosen.numberFormat}
        disabled={isPending}
        choices={NUMBER_FORMATS.map((format) => ({
          value: format,
          label:
            format === "auto"
              ? t("formatAutoShort")
              : numberFormatSample(format, formatLocale),
        }))}
        onChoose={(next) =>
          saveFormats({ ...chosen, numberFormat: next }, "numberFormat")
        }
      />

      <Sheet open={pickerOpen} onOpenChange={setPickerOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          // Opening on the search field would put a keyboard over the
          // favourites the sheet exists to show.
          onOpenAutoFocus={openOnContent}
          className="h-[min(800px,calc(100dvh-48px-env(safe-area-inset-top)))] max-h-[calc(100%-48px-env(safe-area-inset-top))] gap-0 overflow-hidden rounded-t-[28px] bg-card pt-2.5 text-card-foreground"
        >
          <CurrencyPicker
            value={code}
            title={t("currencyTitle")}
            onSelect={(next) => {
              // Closed first: a toast raised under an open sheet is painted
              // behind it and its Undo takes no taps.
              setPickerOpen(false);
              saveCurrency(next);
            }}
            onBack={() => setPickerOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * One decision as a row of samples.
 *
 * Every chip is the thing it produces — "13/08/2026", "1 234 567,89" — so
 * there is nothing to decode. `Auto` is the exception and says so on the right
 * of the label instead, because a chip reading "suit ton navigateur" would be
 * three times the width of the four it sits beside.
 *
 * Radix is not involved: a chip row is a toolbar of samples rather than a list
 * to arrow through, so it is drawn as a `radiogroup` of buttons with
 * `aria-checked`, which is what it actually is.
 */
function ChipRow<T extends string>({
  label,
  hint,
  value,
  choices,
  onChoose,
  disabled,
  name,
}: {
  label: string;
  /** Shown only where the value is `auto`, which is what needs explaining. */
  hint: string | null;
  value: T;
  choices: readonly { value: T; label: string }[];
  onChoose: (value: T) => void;
  disabled?: boolean;
  name: string;
}) {
  return (
    <section className="flex shrink-0 flex-col gap-2.25">
      <div className="flex items-baseline justify-between gap-3 px-1.5">
        <h2
          id={`${name}-label`}
          className="text-2xs font-semibold tracking-[0.11em] text-muted-foreground uppercase"
        >
          {label}
        </h2>
        {hint && (
          <span className="shrink-0 text-2xs text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={`${name}-label`}
        className="flex flex-wrap gap-1.5"
      >
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={choice.value === value}
            disabled={disabled}
            onClick={() => onChoose(choice.value)}
            className={cn(
              "flex h-8.5 shrink-0 items-center rounded-full px-3.25 text-xs font-medium tabular-nums",
              "transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              "focus-visible:outline-none disabled:opacity-50",
              choice.value === value
                ? "bg-primary/18 text-[color-mix(in_oklch,var(--primary)_62%,var(--foreground))] ring-1 ring-primary/45"
                : "bg-foreground/5 ring-1 ring-foreground/9 hover:bg-foreground/8",
            )}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </section>
  );
}
