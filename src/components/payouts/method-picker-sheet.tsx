"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Search, X } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MethodMark } from "@/components/settlements/method-mark";
import { cn } from "@/lib/utils";
import {
  countryForTimezone,
  findPaymentMethod,
  methodsForCountry,
  PAYMENT_METHOD_MAX_LENGTH,
  PAYMENT_METHODS,
  searchPaymentMethods,
  type SupportedCountry,
} from "@/modules/settlements/payment-methods";

/**
 * The whole catalogue, over the list of what you have already added.
 *
 * Thirty-three methods is far too many to put on the screen behind this, and
 * far too few to make somebody scroll an alphabet for the one their country
 * actually uses. So the sheet opens on the four the region suggests, with the
 * rest below in alphabetical order, and search collapses both into one ranked
 * list the moment anybody types.
 *
 * Search is the catalogue's own — prefix beats substring, aliases included —
 * so "virement" finds the bank transfer and "especes" finds cash. Somebody
 * looking for a scheme by the name they use for it should not have to know
 * ours.
 *
 * **Nothing here is a limit.** A query that matches nothing offers to store
 * what was typed, verbatim: the catalogue decides what is *offered*, never
 * what is *allowed*, and a method we have not heard of is a method somebody is
 * being paid by regardless.
 *
 * A method already on the list stays visible and goes inert rather than
 * disappearing. A list that shortens as it is used loses the reader's place,
 * and "why is TWINT not here" is a worse question than a dimmed row that
 * answers it with a tick.
 */
export function MethodPickerSheet({
  open,
  onOpenChange,
  added,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Codes already on the list — ticked, dimmed and inert. */
  added: readonly string[];
  onAdd: (method: string) => void;
}) {
  const t = useTranslations("payouts");
  const tMethods = useTranslations("paymentMethods");
  const tCountries = useTranslations("countries");
  const [query, setQuery] = useState("");

  /*
   * The country, from the phone's own timezone.
   *
   * The best signal there is before anybody has been asked anything — better
   * than the currency, which says nothing (EUR spans twenty countries), and
   * better than one more question on a screen that is already a list.
   */
  const country = useMemo<SupportedCountry | null>(
    () =>
      typeof Intl === "undefined"
        ? null
        : countryForTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone),
    [],
  );

  const label = (id: string) => tMethods(id as Parameters<typeof tMethods>[0]);
  const trimmed = query.trim();

  const sections = useMemo(() => {
    if (trimmed !== "") {
      const found = searchPaymentMethods(trimmed, label);
      return found.length > 0
        ? [{ title: t("picker.results"), methods: found }]
        : [];
    }

    const suggested = methodsForCountry(country);
    const rest = PAYMENT_METHODS.filter(
      (method) => !suggested.includes(method.id),
    ).sort((a, b) => label(a.id).localeCompare(label(b.id)));

    return [
      {
        title: country
          ? t("picker.commonIn", { country: tCountries(country) })
          : t("picker.common"),
        // Ordered by how likely the country makes each one, not by name: the
        // whole reason for this section is that TWINT belongs above Alipay in
        // Zurich.
        methods: suggested
          .map((id) => findPaymentMethod(id))
          .filter((method) => method !== undefined),
      },
      { title: t("picker.all"), methods: rest },
    ];
    // `label` and the catalogue are stable for a locale; the query is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, country, t, tCountries, tMethods]);

  const choose = (method: string) => {
    setQuery("");
    onOpenChange(false);
    onAdd(method);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="h-[calc(100dvh-56px-env(safe-area-inset-top))] max-h-[calc(100%-56px-env(safe-area-inset-top))] gap-0 overflow-hidden rounded-t-[28px] bg-card text-card-foreground"
      >
        <header className="flex shrink-0 items-center gap-2 px-4 pt-1.5 pb-3">
          <SheetTitle className="min-w-0 flex-1 text-base font-semibold">
            {t("picker.title")}
          </SheetTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={t("picker.close")}
            className="tap-target flex size-7 shrink-0 items-center justify-center rounded-full bg-wash-3 text-foreground transition-colors hover:bg-wash-4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <X aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
          </button>
        </header>

        <div className="shrink-0 px-4 pb-2">
          <div className="flex h-10 items-center gap-2.5 rounded-xl bg-wash-2 px-3 inset-ring inset-ring-foreground/10">
            <Search
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("picker.searchPlaceholder")}
              aria-label={t("picker.searchLabel")}
              maxLength={PAYMENT_METHOD_MAX_LENGTH}
              autoComplete="off"
              // 16px on a phone, or Safari zooms the sheet in on focus and
              // never zooms back out. The design's size returns from `md:`.
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-1 pb-5">
          {sections.map((section) => (
            <section key={section.title} className="flex flex-col gap-0.5">
              <h3 className="px-2 py-1 text-2xs font-semibold tracking-[0.11em] text-muted-foreground uppercase">
                {section.title}
              </h3>
              {section.methods.map((method) => (
                <MethodRow
                  key={method.id}
                  method={method.id}
                  label={label(method.id)}
                  added={added.includes(method.id)}
                  onSelect={() => choose(method.id)}
                />
              ))}
            </section>
          ))}

          {/* Not an empty state: an offer. Whatever was typed is a method
              somebody is being paid by, whether or not we list it. */}
          {sections.length === 0 && (
            <MethodRow
              method={trimmed}
              label={trimmed}
              added={added.some(
                (one) => one.toLowerCase() === trimmed.toLowerCase(),
              )}
              name={t("picker.useTyped", { name: trimmed })}
              onSelect={() => choose(trimmed)}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MethodRow({
  method,
  label,
  name,
  added,
  onSelect,
}: {
  method: string;
  label: string;
  /** Overrides the visible text — the free-text row says "Use «…»". */
  name?: string;
  added: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={added}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors",
        added
          ? "pointer-events-none opacity-50"
          : "hover:bg-wash-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
      )}
    >
      <MethodMark
        method={findPaymentMethod(method) ?? null}
        label={label}
        size={30}
        unbranded="tile"
      />
      <span className="min-w-0 flex-1 truncate text-sm">{name ?? label}</span>
      <Check
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0",
          added ? "text-primary-ink" : "text-transparent",
        )}
        strokeWidth={2.4}
      />
    </button>
  );
}
