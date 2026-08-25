"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Banknote, Check, Landmark, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_MAX_LENGTH,
  ROW_METHOD_COUNT,
  findPaymentMethod,
  searchPaymentMethods,
  type PaymentMethod,
  type PaymentMethodId,
  type SupportedCountry,
} from "@/modules/settlements/payment-methods";
import { MemberAvatar, MemberPill, type EntryMember } from "./pills";

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
  /**
   * What the debt is denominated in.
   *
   * Carried per pair rather than taken from the group, because a group in
   * `separate` mode has no base currency at all and still owes money — in
   * several currencies at once, one row each.
   */
  readonly currency: string;
  readonly amountFormatted: string;
}

/**
 * Who is paying whom, picked from the group rather than from its debts.
 *
 * The outstanding list below is the right way *in* to a repayment: it starts
 * from a debt that already exists and turns the commonest case into one tap.
 * It is the wrong way to change one. A settlement that has been recorded has
 * already cleared the debt it was for, so the pair is by definition no longer
 * outstanding — and correcting one that named the wrong person means naming
 * somebody who never owed anything in the first place. Editing therefore gets
 * the whole group, twice, and picks a side each time.
 *
 * Two radiogroups rather than two dropdowns: the count is the group's, which is
 * small, and a face is quicker to find than a name in a list. Each row is
 * one-of-many, so a screen reader says "2 of 4" instead of announcing four
 * toggles that merely happen to be exclusive.
 *
 * Picking somebody who already holds the other side swaps the two, which is
 * what reversing a repayment means and the only thing the tap could sensibly
 * do. Nothing is ever disabled: a control that cannot be pressed says less
 * about why than one that does something reasonable.
 */
export function PairPicker({
  members,
  fromId,
  toId,
  onChange,
}: {
  members: readonly EntryMember[];
  fromId: string | null;
  toId: string | null;
  onChange: (next: { fromId: string | null; toId: string | null }) => void;
}) {
  const t = useTranslations("addEntry.settle");

  const pick = (side: "from" | "to", id: string) => {
    const other = side === "from" ? toId : fromId;
    // The person is already on the other side, so this is a reversal.
    const swapped = other === id ? (side === "from" ? fromId : toId) : other;
    onChange(
      side === "from"
        ? { fromId: id, toId: swapped }
        : { fromId: swapped, toId: id },
    );
  };

  return (
    <div className="space-y-3">
      <PairSide
        label={t("from")}
        members={members}
        selectedId={fromId}
        onSelect={(id) => pick("from", id)}
      />
      <PairSide
        label={t("to")}
        members={members}
        selectedId={toId}
        onSelect={(id) => pick("to", id)}
        tone="payer"
      />
    </div>
  );
}

/**
 * One of the two rows.
 *
 * The tones are the ones the split sheet already uses for its two questions:
 * coral for the side being asked about first, amber for the other. Two rows of
 * identical coral pills would leave the only difference between "paying" and
 * "being paid" in a four-letter heading above them.
 */
function PairSide({
  label,
  members,
  selectedId,
  onSelect,
  tone = "primary",
}: {
  label: string;
  members: readonly EntryMember[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  tone?: "primary" | "payer";
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </h2>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-2"
      >
        {members.map((member) => (
          <MemberPill
            key={member.id}
            name={member.displayName}
            label={`${label}: ${member.displayName}`}
            selected={member.id === selectedId}
            onToggle={() => onSelect(member.id)}
            tone={tone}
            choice
          />
        ))}
      </div>
    </section>
  );
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
      <h2 className="text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
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
                  {t("paysBack", { from: pair.fromName, to: pair.toName })}
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
 *
 * A method somebody named themselves has no brand at all, so it takes the
 * app's own surface rather than a hue invented for it: still a tile, still the
 * initial, and honestly not one of ours.
 */
function MethodMark({
  method,
  label,
  size = 22,
}: {
  /** The listed method, or null for a name typed on the settle screen. */
  method: PaymentMethod | null;
  label: string;
  size?: number;
}) {
  const [logoLoaded, setLogoLoaded] = useState(false);
  const radius = size / 3.4;

  if (method === null) {
    return (
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center bg-white/10 font-semibold text-foreground shadow-[inset_0_0_0_1px_oklch(1_0_0_/_0.16)]"
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          fontSize: size * 0.5,
        }}
      >
        {label.trim().charAt(0).toUpperCase()}
      </span>
    );
  }

  if (method.kind === "cash") {
    return <Banknote aria-hidden="true" className="size-5" />;
  }
  if (method.kind === "bank") {
    return <Landmark aria-hidden="true" className="size-5" />;
  }

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
  customLabel,
  country,
  onSelect,
  onOpenAll,
}: {
  /** Everything the country suggests, most likely first. */
  methods: readonly PaymentMethodId[];
  /** The chosen method, or null while nobody has chosen one. */
  value: PaymentMethodId | null;
  /** A name typed by hand, when the choice is not one of the listed methods. */
  customLabel: string;
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
  // Nothing is pre-selected. The country's first suggestion used to be lit up
  // before anybody had touched the row, and a highlighted chip is a claim —
  // every repayment then recorded "TWINT" whether or not that is how the money
  // moved. How it was paid is optional, so an untouched row says nothing.
  // A method chosen from the picker takes the "Other" slot's label, so the row
  // always shows what is actually selected — a name typed by hand included,
  // which the row can only ever show here.
  const offRow = value !== null ? !shown.includes(value) : customLabel !== "";

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {t("paidBy")}
        </h2>
        {country && (
          <span className="text-2xs text-muted-foreground">
            {tCountries(country)}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        {shown.map((id) => {
          const method = findPaymentMethod(id);
          if (!method) return null;
          const label = tMethods(id);
          const active = id === value;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              aria-pressed={active}
              className={cn(
                "flex h-16 flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border transition-colors",
                active
                  ? "border-primary bg-primary/10"
                  : "border-border bg-white/4",
              )}
            >
              <MethodMark method={method} label={label} />
              <span
                className={cn(
                  "truncate text-xs",
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
            "flex h-16 flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed transition-colors",
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
              "truncate text-xs",
              offRow ? "font-semibold text-foreground" : "",
            )}
          >
            {offRow ? (value ? tMethods(value) : customLabel) : t("other")}
          </span>
        </button>
      </div>
    </section>
  );
}

/**
 * The whole list, plus a way out of it.
 *
 * The list is what is *offered*, never what is allowed: the column has always
 * been free text, and a settlement imported from elsewhere can already carry a
 * name nothing here matches. This is that door from the inside — the search
 * field doubles as the name, so failing to find a method and naming it are one
 * gesture instead of two screens, and the row that offers it appears at the
 * exact moment the list has let somebody down.
 */
export function PaymentMethodSheet({
  value,
  customLabel,
  country,
  suggested,
  onSelect,
  onSelectCustom,
}: {
  value: PaymentMethodId | null;
  /** The name already typed for this repayment, if it was named by hand. */
  customLabel: string;
  country: SupportedCountry | null;
  /** The country trio, pinned above the alphabet. */
  suggested: readonly PaymentMethodId[];
  onSelect: (id: PaymentMethodId) => void;
  onSelectCustom: (name: string) => void;
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

  const typed = query.trim();
  const searching = typed !== "";
  /**
   * Whether what was typed can be taken at its word.
   *
   * Not when the list already answers to it: storing a second spelling of a
   * method sitting one row above is how "Twint" and "TWINT" end up as two
   * different things in a group's history.
   */
  const namable =
    searching &&
    !matches.some(
      (method) => label(method.id).toLowerCase() === typed.toLowerCase(),
    );

  const alphabetical = useMemo(
    () => [...matches].sort((a, b) => label(a.id).localeCompare(label(b.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matches],
  );

  return (
    <div className="flex flex-col gap-3">
      <SheetTitle className="text-lg font-semibold tracking-[-0.02em]">
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
          maxLength={PAYMENT_METHOD_MAX_LENGTH}
          className="h-11 pl-9"
        />
      </div>

      <div className="-mx-1 max-h-[46vh] overflow-y-auto px-1">
        {!searching && customLabel !== "" && (
          <CustomMethodRow
            heading={t("namedByYou")}
            name={customLabel}
            text={customLabel}
            selected
            onSelect={() => onSelectCustom(customLabel)}
          />
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

        {namable && (
          <CustomMethodRow
            heading={t("notListed")}
            name={typed}
            text={t("useMethodName", { name: typed })}
            selected={typed.toLowerCase() === customLabel.toLowerCase()}
            onSelect={() => onSelectCustom(typed)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * A method by the name somebody gave it.
 *
 * Drawn as a row of the list rather than as a form below it: it is one of the
 * answers to the same question, and a text field with its own button underneath
 * thirty tappable rows would read as a different question entirely.
 */
function CustomMethodRow({
  heading,
  name,
  text,
  selected,
  onSelect,
}: {
  heading: string;
  /** What the tile draws its initial from. */
  name: string;
  /** What the row says — the name itself, or an invitation to use it. */
  text: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <section className="mb-2">
      <h3 className="px-2.5 pt-2 pb-1 text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {heading}
      </h3>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors active:bg-accent",
          selected && "bg-accent",
        )}
      >
        <MethodMark method={null} label={name} size={30} />
        <span className="flex-1 truncate text-sm">{text}</span>
        {selected && (
          <Check aria-hidden="true" className="size-4 text-primary" />
        )}
      </button>
    </section>
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
        <h3 className="px-2.5 pt-2 pb-1 text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
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
