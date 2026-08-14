"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Banknote, Check, Landmark, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  PAYMENT_METHODS,
  ROW_METHOD_COUNT,
  findPaymentMethod,
  searchPaymentMethods,
  type PaymentMethod,
  type PaymentMethodId,
  type SupportedCountry,
} from "@/modules/settlements/payment-methods";
import { MemberAvatar } from "./pills";

/**
 * The settlement half of the screen.
 *
 * A repayment does not start from an empty amount — it starts from a debt that
 * already exists. Listing what is outstanding and letting someone tap the pair
 * turns the commonest case ("pay Hervé back what I owe him") into one tap plus
 * confirm, and it removes the two dropdowns the old dialog needed to establish
 * who was paying whom.
 */

export interface DebtPair {
  readonly fromParticipantId: string;
  readonly fromName: string;
  readonly toParticipantId: string;
  readonly toName: string;
  readonly amountMinor: string;
  readonly amountFormatted: string;
}

export function OutstandingList({
  pairs,
  selectedIndex,
  onSelect,
}: {
  pairs: readonly DebtPair[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const t = useTranslations("addEntry.settle");

  if (pairs.length === 0) {
    return (
      <p className="rounded-[17px] bg-card p-4 text-center text-sm text-muted-foreground shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)]">
        {t("nothingOutstanding")}
      </p>
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {t("outstanding")}
      </h2>
      <ul className="overflow-hidden rounded-[17px] bg-card shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)]">
        {pairs.map((pair, index) => {
          const active = index === selectedIndex;
          return (
            <li key={`${pair.fromParticipantId}-${pair.toParticipantId}`}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-pressed={active}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-white/8 p-3 text-left transition-colors last:border-b-0",
                  active && "bg-white/6",
                )}
              >
                <MemberAvatar name={pair.fromName} selected={active} />
                <span className="flex-1 truncate text-sm">
                  {t("owes", { from: pair.fromName, to: pair.toName })}
                </span>
                <span
                  className={cn(
                    "text-sm tabular-nums",
                    active
                      ? "font-semibold text-positive"
                      : "text-muted-foreground",
                  )}
                >
                  {pair.amountFormatted}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-white/25",
                  )}
                >
                  {active && <Check className="size-3" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * A payment method's mark.
 *
 * Balancia ships no provider artwork: the marks belong to their owners, and a
 * trademark licence does not survive being redistributed by every fork of an
 * AGPL repository. So the default is a lettermark on the brand's own hue,
 * which reads as "a payment app" without pretending to be an official asset.
 *
 * An operator who *does* have the right to display a provider's logo drops it
 * into `public/payment-methods/<id>.svg` and it appears here instead. That
 * file never enters the repository, which is the whole point — see the README
 * in that directory.
 *
 * The lettermark is painted first and the logo is layered over it, revealed
 * only once it has actually loaded. Nothing has to know in advance which files
 * an operator supplied: a missing one simply never reveals itself, so there is
 * no probe, no manifest to keep in step, and no broken-image frame.
 *
 * Cash and bank transfer are drawn glyphs — neither is a brand.
 */
function MethodMark({
  method,
  label,
  size = 22,
}: {
  method: PaymentMethod;
  label: string;
  size?: number;
}) {
  const [logoLoaded, setLogoLoaded] = useState(false);

  if (method.kind === "cash") {
    return <Banknote aria-hidden="true" className="size-5" />;
  }
  if (method.kind === "bank") {
    return <Landmark aria-hidden="true" className="size-5" />;
  }

  const radius = size / 3.4;

  return (
    <span
      aria-hidden="true"
      className="relative flex shrink-0 items-center justify-center font-semibold shadow-[inset_0_0_0_1px_oklch(1_0_0_/_0.16)]"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: size * 0.5,
        // The tile's own colour is dropped once a logo covers it: a supplied
        // mark brings its own background, and the brand hue behind it would
        // only fight with it.
        background: logoLoaded ? "transparent" : method.brandColor,
        color: method.onBrand === "dark" ? "oklch(0.226 0.072 319)" : "#fff",
      }}
    >
      {!logoLoaded && label.charAt(0).toUpperCase()}
      {/* eslint-disable-next-line @next/next/no-img-element -- an operator drops
          these in at runtime, so there is nothing for the image optimiser to
          resolve at build time, and a 404 must stay silent. */}
      <img
        src={`/payment-methods/${method.id}.svg`}
        alt=""
        onLoad={() => setLogoLoaded(true)}
        className="absolute inset-0 size-full object-contain"
        style={{ borderRadius: radius, opacity: logoLoaded ? 1 : 0 }}
      />
    </span>
  );
}

export function PaymentMethodRow({
  methods,
  value,
  country,
  onSelect,
  onOpenAll,
}: {
  /** Everything the country suggests, most likely first. */
  methods: readonly PaymentMethodId[];
  /** The chosen method, or null while the first suggestion still stands. */
  value: PaymentMethodId | null;
  country: SupportedCountry | null;
  onSelect: (id: PaymentMethodId) => void;
  onOpenAll: () => void;
}) {
  const t = useTranslations("addEntry.settle");
  const tMethods = useTranslations("paymentMethods");
  const tCountries = useTranslations("countries");

  // Three fit across a phone beside the "Other" button; a fourth would squeeze
  // every label to the point of truncating "Bancontact Pay". The rest of the
  // country's list is one tap away, at the top of the picker.
  const shown = methods.slice(0, ROW_METHOD_COUNT);
  const resolved = value ?? shown[0];
  // A method chosen from the picker takes the "Other" slot's label, so the row
  // always shows what is actually selected.
  const offRow = value !== null && !shown.includes(value);

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {t("paidBy")}
        </h2>
        {country && (
          <span className="text-[11px] text-muted-foreground">
            {tCountries(country)}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        {shown.map((id) => {
          const method = findPaymentMethod(id);
          if (!method) return null;
          const label = tMethods(id);
          const active = !offRow && id === resolved;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              aria-pressed={active}
              className={cn(
                "flex h-12 flex-1 flex-col items-center justify-center gap-1 rounded-xl border transition-colors",
                active
                  ? "border-primary bg-primary/10"
                  : "border-border bg-white/4",
              )}
            >
              <MethodMark method={method} label={label} />
              <span
                className={cn(
                  "truncate text-[13px]",
                  active
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={onOpenAll}
          className={cn(
            "flex h-12 flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-dashed transition-colors",
            offRow
              ? "border-primary bg-primary/10"
              : "border-white/22 text-muted-foreground",
          )}
        >
          {offRow ? null : (
            <Search aria-hidden="true" className="size-[18px]" />
          )}
          <span
            className={cn(
              "truncate text-[13px]",
              offRow ? "font-semibold text-foreground" : "",
            )}
          >
            {offRow && value ? tMethods(value) : t("other")}
          </span>
        </button>
      </div>
    </section>
  );
}

export function PaymentMethodSheet({
  value,
  country,
  suggested,
  onSelect,
}: {
  value: PaymentMethodId | null;
  country: SupportedCountry | null;
  /** The country trio, pinned above the alphabet. */
  suggested: readonly PaymentMethodId[];
  onSelect: (id: PaymentMethodId) => void;
}) {
  const t = useTranslations("addEntry.settle");
  const tMethods = useTranslations("paymentMethods");
  const tCountries = useTranslations("countries");
  const [query, setQuery] = useState("");

  const label = (id: string) => tMethods(id as PaymentMethodId);

  const matches = useMemo(
    () => searchPaymentMethods(query, label),
    // `label` is stable for a given locale; the translations do not change
    // while the sheet is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query],
  );

  const searching = query.trim() !== "";
  const alphabetical = useMemo(
    () => [...matches].sort((a, b) => label(a.id).localeCompare(label(b.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matches],
  );

  return (
    <div className="flex flex-col gap-3">
      <SheetTitle className="text-[19px] font-semibold tracking-[-0.02em]">
        {t("methodTitle")}
      </SheetTitle>

      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("methodSearch")}
          aria-label={t("methodSearch")}
          className="h-11 pl-9"
        />
      </div>

      <div className="-mx-1 max-h-[46vh] overflow-y-auto px-1">
        {matches.length === 0 && (
          <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
            {t("noMethod")}
          </p>
        )}

        {!searching && country && (
          <MethodGroup
            heading={t("commonIn", { country: tCountries(country) })}
            ids={suggested}
            value={value}
            onSelect={onSelect}
          />
        )}

        {matches.length > 0 && (
          <MethodGroup
            heading={searching ? null : t("allMethods")}
            ids={alphabetical.map((method) => method.id)}
            value={value}
            onSelect={onSelect}
          />
        )}
      </div>
    </div>
  );
}

function MethodGroup({
  heading,
  ids,
  value,
  onSelect,
}: {
  heading: string | null;
  ids: readonly PaymentMethodId[];
  value: PaymentMethodId | null;
  onSelect: (id: PaymentMethodId) => void;
}) {
  const tMethods = useTranslations("paymentMethods");

  return (
    <section className="mb-2">
      {heading && (
        <h3 className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {heading}
        </h3>
      )}
      <ul>
        {ids.map((id) => {
          const method = findPaymentMethod(id);
          if (!method) return null;
          const label = tMethods(id);
          return (
            <li key={`${heading ?? "all"}-${id}`}>
              <button
                type="button"
                onClick={() => onSelect(id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors active:bg-accent",
                  id === value && "bg-accent",
                )}
              >
                <MethodMark method={method} label={label} size={30} />
                <span className="flex-1 truncate text-sm">{label}</span>
                {id === value && (
                  <Check aria-hidden="true" className="size-4 text-primary" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Every method, for callers that need the full set. */
export { PAYMENT_METHODS };
