"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  openOnContent,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { MemberAvatar, type EntryMember } from "@/components/entries/pills";
import { useSubcategoryLabel } from "@/components/entries/category-sheet";
import {
  CATEGORY_GLYPHS,
  subcategoryGlyph,
} from "@/components/expenses/category-icon";
import {
  EXPENSE_CATEGORY_IDS,
  getSubcategories,
  getSubcategoryGroups,
  hasSubcategories,
  type ExpenseCategory,
} from "@/modules/categorization";
import { cn } from "@/lib/utils";
import {
  clearedFilter,
  filterDimensions,
  KINDS,
  POSITION_CHOICES,
  SORT_CHOICES,
  WHEN_CHOICES,
  type EntryKind,
  type ListFilter,
  type PositionChoice,
  type PropertyChoice,
  type SortChoice,
  type WhenChoice,
} from "./list-filter";

/**
 * Filter and sort, for the axes the screen's other three controls cannot reach.
 *
 * The list already narrows three ways — the kind chips, the category spine and
 * the search field — and this is the fourth, holding what none of them can ask
 * (a period, an amount, a payer, what the row did to you) plus sort, which has
 * nowhere else to live.
 *
 * ## It edits a draft
 *
 * Nothing behind the scrim moves while you are choosing. The draft is owned by
 * the list, not by this component, for the one reason that matters: the apply
 * button previews its own outcome — `Show 4 transactions` — and that number has
 * to be counted by the same predicate over the same rows the list is holding.
 * A count computed in here would be a second opinion, and second opinions
 * drift. So the sheet renders a draft it is handed and reports every change
 * back; the list re-runs `selectRows` and hands the number down.
 *
 * ## Type and Category are not this sheet's
 *
 * They already exist outside it, as the chip row and the spine, and all three
 * controls write one filter. Choosing Groceries here lights that band; tapping
 * that band shows Groceries already chosen next time the sheet opens. There is
 * no synchronisation because there is nothing to synchronise — the state lives
 * above all three of them, in the URL.
 */

export interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The draft being edited. Owned above, so the count can be honest. */
  draft: ListFilter;
  onDraftChange: (draft: ListFilter) => void;
  /** Commits the draft to the list. */
  onApply: () => void;
  /** How many rows the draft would leave standing, from the list's own predicate. */
  count: number;
  /** Which kinds the group holds — the same rule the chip row follows. */
  kinds: readonly EntryKind[];
  members: readonly EntryMember[];
  /** The taxonomy categories the group has filed something under, in taxonomy order. */
  used: readonly ExpenseCategory[];
  /** How many transactions each category holds, over the whole group. */
  counts: Readonly<Record<string, number>>;
  /** The group's first transaction date; the floor a custom range cannot go below. */
  firstDate: string | null;
  /** Today, in the group's timezone. */
  today: string;
  /** False when the list spans several currencies and magnitudes cannot be ranked. */
  byAmount: boolean;
}

export function FilterSheet({
  open,
  onOpenChange,
  draft,
  onDraftChange,
  onApply,
  count,
  kinds,
  members,
  used,
  counts,
  firstDate,
  today,
  byAmount,
}: FilterSheetProps) {
  const t = useTranslations("expensesList");
  const tf = useTranslations("expensesList.filters");
  const dirty = filterDimensions(draft) > 0;

  const set = (patch: Partial<ListFilter>) =>
    onDraftChange({ ...draft, ...patch });

  /** A multi-select section: the value goes in if it is out, and out if it is in. */
  const toggle = <K extends "kinds" | "payers" | "positions" | "properties">(
    field: K,
    value: ListFilter[K][number],
  ) => {
    const current = draft[field] as readonly ListFilter[K][number][];
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    set({ [field]: next } as unknown as Partial<ListFilter>);
  };

  /*
   * Choosing a custom range fills it with the group's whole history, so the
   * default answer to "which dates?" is one the reader can narrow rather than
   * a pair of empty fields they have to fill before anything happens.
   */
  const chooseWhen = (when: WhenChoice) => {
    if (when !== "custom") {
      set({ when, from: "", to: "" });
      return;
    }
    set({
      when,
      from: draft.from || (firstDate ?? ""),
      to: draft.to || today,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        // On the sheet itself rather than on its first control, which would be
        // Reset — a button that is inert on arrival, and the one thing here
        // nobody opened the sheet to press.
        onOpenAutoFocus={openOnContent}
        // A fixed frame with a scrolling middle: the header and the apply
        // button hold their places, and only the sections move.
        className="mx-auto flex max-h-[88dvh] max-w-[430px] flex-col gap-0 overflow-hidden rounded-t-[22px] px-0 pt-2.5 pb-0"
      >
        <div className="flex items-center gap-3 px-4 pt-1 pb-3">
          <SheetTitle className="flex-1 text-lg font-semibold tracking-[-0.02em]">
            {tf("title")}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {tf("description")}
          </SheetDescription>
          <button
            type="button"
            onClick={() => onDraftChange(clearedFilter(draft))}
            disabled={!dirty}
            // Coral ink, but only where coral carries: it measures 2.7:1 on
            // the light popover and 5.6:1 on the dark one, so the light theme
            // takes the ink it can read and keeps the weight that says this is
            // a control. Same trade the spread's bands make.
            className="-mx-2 flex h-11 items-center rounded-lg px-2 text-sm font-semibold text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:text-muted-foreground/60 motion-reduce:transition-none dark:text-primary"
          >
            {tf("reset")}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={tf("close")}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-5">
          <Section label={tf("when")} single>
            <Chips>
              {WHEN_CHOICES.map((when) => (
                <FilterChip
                  key={when}
                  single
                  selected={draft.when === when}
                  onClick={() => chooseWhen(when)}
                >
                  {tf(`when_${when}`)}
                </FilterChip>
              ))}
            </Chips>
            {draft.when === "custom" && (
              <div className="mt-3 flex flex-col gap-2">
                <DateField
                  label={tf("from")}
                  value={draft.from}
                  min={firstDate}
                  max={draft.to || today}
                  onChange={(from) => set({ from })}
                />
                <DateField
                  label={tf("to")}
                  value={draft.to}
                  min={draft.from || firstDate}
                  max={today}
                  onChange={(to) => set({ to })}
                />
              </div>
            )}
          </Section>

          {/* The same rule the chip row follows: a section whose every option
              says what the list already says is a control that can only be
              switched off. */}
          {kinds.length > 1 && (
            <Section label={tf("type")}>
              <Chips>
                {KINDS.filter((kind) => kinds.includes(kind)).map((kind) => (
                  <FilterChip
                    key={kind}
                    selected={draft.kinds.includes(kind)}
                    onClick={() => toggle("kinds", kind)}
                  >
                    {t(`kind_${kind}`)}
                  </FilterChip>
                ))}
              </Chips>
            </Section>
          )}

          <Section label={tf("amount")}>
            <div className="flex items-center gap-2">
              <AmountField
                label={tf("min")}
                placeholder={tf("minPlaceholder")}
                value={draft.min}
                onChange={(min) => set({ min })}
              />
              <span className="shrink-0 text-xs text-muted-foreground">
                {tf("amountTo")}
              </span>
              <AmountField
                label={tf("max")}
                placeholder={tf("maxPlaceholder")}
                value={draft.max}
                onChange={(max) => set({ max })}
              />
            </div>
          </Section>

          {members.length > 1 && (
            <Section label={tf("paidBy")} hint={tf("anyOf")}>
              <Chips>
                {members.map((member) => {
                  const on = draft.payers.includes(member.id);
                  return (
                    <FilterChip
                      key={member.id}
                      selected={on}
                      onClick={() => toggle("payers", member.id)}
                      leading={
                        <MemberAvatar
                          name={member.displayName}
                          selected={on}
                          className="-ml-1.5 size-5"
                        />
                      }
                    >
                      {member.displayName}
                    </FilterChip>
                  );
                })}
              </Chips>
            </Section>
          )}

          <CategorySection
            draft={draft}
            onDraftChange={onDraftChange}
            used={used}
            counts={counts}
          />

          <Section label={tf("position")}>
            <Chips>
              {POSITION_CHOICES.map((position) => (
                <FilterChip
                  key={position}
                  selected={draft.positions.includes(position)}
                  onClick={() => toggle("positions", position)}
                >
                  {tf(`position_${position}`)}
                </FilterChip>
              ))}
            </Chips>
          </Section>

          <Section label={tf("only")}>
            <Chips>
              {PROPERTIES.map((property) => (
                <FilterChip
                  key={property}
                  selected={draft.properties.includes(property)}
                  onClick={() => toggle("properties", property)}
                >
                  {tf(`only_${property}`)}
                </FilterChip>
              ))}
            </Chips>
          </Section>

          <Section label={tf("sort")} single>
            <Chips>
              {SORT_CHOICES.filter(
                (sort) => byAmount || sort !== "largest",
              ).map((sort) => (
                <FilterChip
                  key={sort}
                  single
                  selected={draft.sort === sort}
                  onClick={() => set({ sort: sort as SortChoice })}
                >
                  {tf(`sort_${sort}`)}
                </FilterChip>
              ))}
            </Chips>
          </Section>
        </div>

        {/* Pinned, and never scrolled away from: the number on it is the whole
            argument for pressing it. */}
        <div className="shrink-0 border-t bg-popover px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onApply}
            className="flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
          >
            {tf("apply", { count })}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** In the order the sheet draws them, which is not the order they are stored. */
const PROPERTIES: readonly PropertyChoice[] = ["series", "foreign", "receipt"];

/**
 * A labelled run of controls.
 *
 * `single` is not decoration. When and Sort look exactly like the multi-select
 * sections above and below them and behave completely differently, so the
 * grouping says which it is: a radio group announces "1 of 4", a plain group
 * announces four independent toggles.
 */
function Section({
  label,
  hint,
  single = false,
  children,
}: {
  label: string;
  hint?: string;
  single?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      role={single ? "radiogroup" : "group"}
      aria-label={hint ? `${label} — ${hint}` : label}
    >
      <h3 className="mb-2.5 flex items-baseline gap-2 text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
        {hint && (
          <span className="font-medium tracking-normal normal-case">
            {hint}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

/**
 * The row a set of chips wraps onto.
 *
 * The vertical gap is 12px rather than the horizontal 8px because each chip
 * reaches 6px past its own edge for the finger — see `FilterChip` — and two
 * rows 8px apart would have overlapping hit areas, where the row above quietly
 * takes taps meant for the row below.
 */
function Chips({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-x-2 gap-y-3">{children}</div>;
}

/**
 * One choice.
 *
 * 32px tall, as drawn, with the hit area padded to 44px by a pseudo-element
 * instead of by growing the pill: a row of 44px pills is a wall, and the size
 * of the target is not the size of the thing.
 *
 * Selected is fill *and* weight, never colour alone.
 */
function FilterChip({
  children,
  selected,
  onClick,
  single = false,
  leading,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  single?: boolean;
  leading?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role={single ? "radio" : undefined}
      aria-checked={single ? selected : undefined}
      aria-pressed={single ? undefined : selected}
      className={cn(
        "relative inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
        // 32px of pill, 44px of finger.
        "before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
        leading && "pl-2",
        selected
          ? "bg-primary font-semibold text-primary-foreground"
          : "bg-muted font-medium text-muted-foreground hover:text-foreground",
      )}
    >
      {leading}
      {children}
    </button>
  );
}

/**
 * One end of a range.
 *
 * The label sits inside the field rather than above it, because two stacked
 * fields with headings is four lines for one question — and `from` and `to`
 * are short enough to read at a glance where they are used.
 */
function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min: string | null;
  max: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-12 items-center gap-3 rounded-xl border border-input px-3">
      <span className="w-9 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <Input
        type="date"
        value={value}
        // The group's first transaction is the floor. There is nothing before
        // it to find, and a range that starts in 1970 is not a range.
        min={min ?? undefined}
        max={max ?? undefined}
        onChange={(event) => onChange(event.target.value)}
        className="h-auto flex-1 border-0 bg-transparent p-0 font-medium focus-visible:ring-0"
      />
    </label>
  );
}

function AmountField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      // Not `type="number"`: a spinner is meaningless on a phone and the
      // browser's own validation would fight the comma this accepts.
      inputMode="decimal"
      value={value}
      aria-label={label}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="h-12 flex-1 rounded-xl"
    />
  );
}

/**
 * Category, as a list rather than a chip cloud.
 *
 * Fifteen categories over a hundred and twenty-six subcategories will not fit
 * in a run of pills, and flattening them would lose the thing that makes the
 * vocabulary usable: that you pick a category first and only then say what
 * kind. So it is the entry form's category sheet again, in the shape a filter
 * needs — the tile and the name toggle the whole category, the caret opens its
 * subcategories underneath, and one category is open at a time.
 *
 * The pair is the filter. Choosing Rent does not choose Home, and a Home with
 * some of its children chosen is drawn as a ring rather than a fill, because
 * it is a different filter from Home itself and must not look like it.
 */
function CategorySection({
  draft,
  onDraftChange,
  used,
  counts,
}: {
  draft: ListFilter;
  onDraftChange: (draft: ListFilter) => void;
  used: readonly ExpenseCategory[];
  counts: Readonly<Record<string, number>>;
}) {
  const tf = useTranslations("expensesList.filters");
  const tCategories = useTranslations("expenses.categories");
  const locale = useLocale();
  const [all, setAll] = useState(false);
  /** Which category's subcategories are showing, or null. */
  const [open, setOpen] = useState<ExpenseCategory | null>(null);

  const collator = useMemo(() => new Intl.Collator(locale), [locale]);

  /*
   * The categories the group has actually used, or the whole vocabulary.
   *
   * Opening on what has been used is what makes the list short enough to read;
   * the link at the foot is for the other question — filtering on a category
   * nothing has been filed under yet, to find out that nothing has.
   */
  const shown = all ? EXPENSE_CATEGORY_IDS : used;

  const toggleCategory = (category: ExpenseCategory) => {
    const on = draft.categories.includes(category);
    onDraftChange({
      ...draft,
      categories: on
        ? draft.categories.filter((code) => code !== category)
        : [...draft.categories, category],
      // Picking the whole thing subsumes whichever parts were picked; letting
      // go of it leaves nothing behind either.
      subcategories: draft.subcategories.filter(
        (pair) => !pair.startsWith(`${category}.`),
      ),
    });
  };

  const toggleSubcategory = (category: ExpenseCategory, leaf: string) => {
    const pair = `${category}.${leaf}`;
    const on = draft.subcategories.includes(pair);
    onDraftChange({
      ...draft,
      // A part of a category is not the category, so choosing one lets the
      // whole go — otherwise the parent would keep every row the leaf was
      // meant to narrow away.
      categories: draft.categories.filter((code) => code !== category),
      subcategories: on
        ? draft.subcategories.filter((code) => code !== pair)
        : [...draft.subcategories, pair],
    });
  };

  return (
    <Section label={tf("category")} hint={tf("categoryHint")}>
      {/* A group that has filed nothing under a category yet gets the link and
          no empty box above it — a bordered rectangle with nothing in it is
          not a list of no categories, it is a mistake. */}
      {shown.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border">
          {shown.map((category, index) => (
            <CategoryRow
              key={category}
              category={category}
              label={tCategories(category)}
              count={counts[category] ?? 0}
              whole={draft.categories.includes(category)}
              chosen={draft.subcategories.filter((pair) =>
                pair.startsWith(`${category}.`),
              )}
              open={open === category}
              first={index === 0}
              collator={collator}
              onToggle={() => toggleCategory(category)}
              onOpen={() => setOpen(open === category ? null : category)}
              onToggleSubcategory={(leaf) => toggleSubcategory(category, leaf)}
            />
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setAll(!all)}
        // Underlined rather than coloured, for the reason the Reset link is
        // not coloured either.
        className="mt-2 flex h-11 items-center text-xs font-semibold text-foreground underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-primary"
      >
        {all
          ? tf("showUsed", { count: used.length })
          : tf("showAll", { count: EXPENSE_CATEGORY_IDS.length })}
      </button>
    </Section>
  );
}

function CategoryRow({
  category,
  label,
  count,
  whole,
  chosen,
  open,
  first,
  collator,
  onToggle,
  onOpen,
  onToggleSubcategory,
}: {
  category: ExpenseCategory;
  label: string;
  count: number;
  /** The whole category is the filter. */
  whole: boolean;
  /** The `category.subcategory` pairs chosen under it. */
  chosen: readonly string[];
  open: boolean;
  first: boolean;
  collator: Intl.Collator;
  onToggle: () => void;
  onOpen: () => void;
  onToggleSubcategory: (leaf: string) => void;
}) {
  const tf = useTranslations("expensesList.filters");
  const tGroups = useTranslations("expenses.categoryGroups");
  const tSub = useSubcategoryLabel();
  const Glyph = CATEGORY_GLYPHS[category];
  const branches = hasSubcategories(category);
  const leaves = getSubcategories(category) as readonly string[];
  const groups = getSubcategoryGroups(category);
  const partial = chosen.length > 0;

  /*
   * The second line answers whichever question is live: how much is in here,
   * or — once something has been chosen — how much of it you have taken.
   */
  const meta = whole
    ? tf("allSubcategories")
    : partial
      ? tf("someSubcategories", { chosen: chosen.length, total: leaves.length })
      : tf("categoryCount", { count });

  const sorted = (values: readonly string[]) =>
    [...values]
      .filter((leaf) => leaf !== "other")
      .sort((a, b) => collator.compare(tSub(category, a), tSub(category, b)))
      .concat(values.includes("other") ? ["other"] : []);

  const pill = (leaf: string) => {
    const Leaf = subcategoryGlyph(category, leaf);
    return (
      <FilterChip
        key={leaf}
        selected={chosen.includes(`${category}.${leaf}`)}
        onClick={() => onToggleSubcategory(leaf)}
        leading={
          Leaf ? (
            <Leaf aria-hidden="true" className="size-3.5 shrink-0" />
          ) : undefined
        }
      >
        {tSub(category, leaf)}
      </FilterChip>
    );
  };

  return (
    <div className={cn(!first && "border-t border-border")}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={whole}
          // Named rather than left to the two lines inside it: the name and
          // the count are separate blocks on screen and a screen reader would
          // otherwise run them together into "Lodging2 transactions".
          aria-label={`${label}, ${meta}`}
          className="flex min-h-[60px] flex-1 items-center gap-3 py-2.5 pl-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:-outline-offset-2 focus-visible:outline-none motion-reduce:transition-none"
        >
          {/* Fill for the whole category, a ring for some of it: two states
              that must not look like one, since they are different filters. */}
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-xl transition-colors motion-reduce:transition-none",
              whole
                ? "bg-primary text-primary-foreground"
                : partial
                  ? "bg-primary/15 text-foreground ring-2 ring-primary ring-inset dark:text-primary"
                  : "bg-muted text-muted-foreground",
            )}
          >
            <Glyph aria-hidden="true" className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-sm",
                whole || partial ? "font-semibold" : "font-medium",
              )}
            >
              {label}
            </span>
            <span className="mt-px block truncate text-2xs text-muted-foreground">
              {meta}
            </span>
          </span>
        </button>
        {/* `other` has no second step, so it gets no caret: the shape of the
            row is what says whether there is anything behind it. */}
        {branches && (
          <button
            type="button"
            onClick={onOpen}
            aria-expanded={open}
            aria-label={tf(open ? "closeCategory" : "openCategory", { label })}
            className="grid w-12 shrink-0 place-items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:-outline-offset-2 focus-visible:outline-none motion-reduce:transition-none"
          >
            {open ? (
              <ChevronDown aria-hidden="true" className="size-4" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-4" />
            )}
          </button>
        )}
      </div>

      {open && branches && (
        <div className="space-y-3 pt-1 pr-3 pb-3.5 pl-3">
          {groups ? (
            groups.map(({ group, subcategories }) => (
              <div key={group}>
                <h4 className="mb-2 text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                  {tGroups(
                    `${category}.${group}` as Parameters<typeof tGroups>[0],
                  )}
                </h4>
                <Chips>{sorted(subcategories).map(pill)}</Chips>
              </div>
            ))
          ) : (
            <Chips>{sorted(leaves).map(pill)}</Chips>
          )}
          {groups && leaves.includes("other") && <Chips>{pill("other")}</Chips>}
        </div>
      )}
    </div>
  );
}

export type { PositionChoice, SortChoice, WhenChoice };
