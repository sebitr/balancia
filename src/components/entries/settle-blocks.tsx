"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronRight, Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_MAX_LENGTH,
  ROW_METHOD_COUNT,
  findPaymentMethod,
  searchPaymentMethods,
  type PaymentMethodId,
  type SupportedCountry,
} from "@/modules/settlements/payment-methods";
import { MethodMark } from "@/components/settlements/method-mark";
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
  /**
   * A pair the reader named rather than one the balances produced.
   *
   * Per entry, never saved to the group: it is cleared on save, on cancel,
   * on "Add another" and on switching the type away from Settle. In storage
   * it is an ordinary settlement — the absence of a prior balance is a fact
   * about the group at that moment, not a property of the payment.
   */
  readonly isCustom?: boolean;
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
/**
 * Naming a pair the balances did not.
 *
 * The one sheet in this drawer with a real primary action rather than
 * tap-to-commit, because it collects two values and neither alone is a valid
 * answer. Which is also why the primary is guarded twice: the disabled
 * styling is an affordance, and a programmatic click, a keyboard activation
 * or a stale render goes straight through it. A half-built pair committed
 * that way selects a row that does not exist and leaves the screen with no
 * valid payer.
 */
export function PairSheet({
  members,
  fromId,
  toId,
  onChange,
  onConfirm,
}: {
  members: readonly EntryMember[];
  fromId: string | null;
  toId: string | null;
  onChange: (next: { fromId: string | null; toId: string | null }) => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("addEntry.settle");

  const nameOf = (id: string | null) =>
    members.find((member) => member.id === id)?.displayName ?? "";

  const complete = fromId !== null && toId !== null && fromId !== toId;

  const summary = !fromId
    ? t("pairPickBoth")
    : !toId
      ? t("pairPickReceiver", { name: nameOf(fromId) })
      : t("pairSummary", { from: nameOf(fromId), to: nameOf(toId) });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <SheetTitle className="text-xl font-semibold">
          {t("pairTitle")}
        </SheetTitle>
        {/* The sentence that stops the sheet being alarming. */}
        <p className="text-xs text-muted-foreground">{t("pairSubtitle")}</p>
      </div>

      <PairSide
        label={t("whoPays")}
        members={members}
        selectedId={fromId}
        onSelect={(id) =>
          // Picking a payer who already holds the other side clears it rather
          // than producing a pair of one person.
          onChange({ fromId: id, toId: toId === id ? null : toId })
        }
        tone="payer"
      />
      <PairSide
        label={t("whoReceives")}
        members={members}
        selectedId={toId}
        onSelect={(id) => onChange({ fromId, toId: id })}
        // You cannot pay yourself, and disabling the payer here says so more
        // quietly than an error would.
        disabledId={fromId}
      />

      <p
        className={cn(
          "text-xs",
          complete ? "text-muted-foreground" : "text-destructive-ink",
        )}
      >
        {summary}
      </p>

      <button
        type="button"
        disabled={!complete}
        onClick={() => {
          // Guarded in the handler, not only in CSS.
          if (!complete) return;
          onConfirm();
        }}
        className="h-13 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-35"
      >
        {t("usePair")}
      </button>
    </div>
  );
}

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
  disabledId,
}: {
  label: string;
  members: readonly EntryMember[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  tone?: "primary" | "payer";
  /** Somebody this side cannot be — the payer, in the receiving group. */
  disabledId?: string | null;
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
            disabled={member.id === disabledId}
            choice
          />
        ))}
      </div>
    </section>
  );
}

/**
 * The outstanding debts, and the way out of them.
 *
 * The list is the fast path: almost every settlement is one of these, and
 * prefilling the exact figure is the whole value of the screen. But leading
 * with it once made the rarer payment impossible rather than merely
 * secondary — somebody fronting cash to a person they owe nothing to had
 * nowhere to record it, and the group's balances drifted quietly away from
 * reality.
 *
 * So the escape hatch is the **last row of the same card**, not a button
 * beside it. "Who is settling" is the question this card asks, and paying
 * somebody outside the list is one of the answers — it just belongs at the
 * bottom, where the rare answer goes.
 */
export function OutstandingList({
  pairs,
  selectedIndex,
  onSelect,
  onPickSomeoneElse,
  hasCustomPair = false,
}: {
  pairs: readonly DebtPair[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  /** Opens the pair sheet. Absent on an entry being edited. */
  onPickSomeoneElse?: () => void;
  /** Whether one of the rows above is a pair the reader named themselves. */
  hasCustomPair?: boolean;
}) {
  const t = useTranslations("addEntry.settle");

  const escapeHatch = onPickSomeoneElse ? (
    <li>
      <button
        type="button"
        onClick={onPickSomeoneElse}
        className="flex w-full items-center gap-3 border-b border-white/8 p-3 text-left text-muted-foreground transition-colors last:border-b-0 hover:bg-white/4"
      >
        {/* Dashed, because there is no member to show yet. */}
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-white/30"
        >
          <Plus className="size-3.5" />
        </span>
        <span className="flex-1 truncate text-sm">
          {/*
           * Never the pair's own name: it has a selectable row of its own
           * above, and a row that both names the selection and acts on it
           * reads as two controls.
           */}
          {hasCustomPair ? t("changeWhoPays") : t("someoneElse")}
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
      </button>
    </li>
  ) : null;

  if (pairs.length === 0) {
    return (
      <section className="space-y-2">
        <p className="rounded-[17px] bg-card p-4 text-center text-sm text-muted-foreground shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)]">
          {t("nothingOutstanding")}
        </p>
        {escapeHatch && (
          <ul className="overflow-hidden rounded-[17px] bg-card shadow-[0_0_0_1px_oklch(1_0_0_/_0.1)]">
            {escapeHatch}
          </ul>
        )}
      </section>
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
                      ? "font-semibold text-positive-ink"
                      : "text-muted-foreground",
                  )}
                >
                  {/*
                   * A pair the reader named has no balance to show, and
                   * "0.00" would be a figure rather than the absence of one.
                   * Present tense: the others describe a debt that exists,
                   * this one a payment about to happen.
                   */}
                  {pair.isCustom ? t("noBalance") : pair.amountFormatted}
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
          <Check aria-hidden="true" className="size-4 text-primary-ink" />
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
                  <Check
                    aria-hidden="true"
                    className="size-4 text-primary-ink"
                  />
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
