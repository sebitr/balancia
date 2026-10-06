"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
// Aliased: `ListFilter` is also the name of the object it opens.
import {
  ChevronDown,
  ListFilter as FilterGlyph,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useDateFormatter } from "@/i18n/format-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSubcategoryLabel } from "@/components/entries/category-sheet";
import { CATEGORY_GLYPHS } from "@/components/expenses/category-icon";
import { useOfflineEntry } from "@/components/offline/offline-entry";
import { useOnline } from "@/components/offline/use-online";
import {
  EXPENSE_CATEGORY_IDS,
  type ExpenseCategory,
} from "@/modules/categorization";
import { cn } from "@/lib/utils";
import {
  monthOf,
  monthsBetween,
  withCategory,
  withMonth,
  withoutCategories,
  withWhen,
  type EntryKind,
  type ListFilter,
  type WhenChoice,
} from "./list-filter";

/**
 * The transactions' filters on one row, from `lg` up.
 *
 * A phone asks its questions in three places — the kind chips above the list,
 * the category spine beside it, and a sheet behind a button for everything
 * else — because a phone has one column and a thumb. A desktop window has the
 * width to put the common ones in a row and answer them in place: the search
 * field, the kind chips, a category and a period as menus, and the sheet
 * behind More filters for the rest. The spine gives way to the Category menu
 * here: it stood sticky down the side of the list to be read as a proportion,
 * and beside a table the Category column is that proportion row by row.
 *
 * Nothing here holds a filter of its own. Each control writes the one object
 * in the URL through the moves `list-filter.ts` keeps, which are the sheet's
 * moves too — so Groceries chosen in the menu is chosen in the sheet, a month
 * picked here is the custom range the sheet's date fields then show, and the
 * badge on More filters counts only what this row cannot show.
 *
 * The menus apply as they are used, unlike the sheet, which edits a draft
 * behind a button promising a count. A menu is one question with its answer
 * under the pointer, and the table beneath it is the count.
 */

export interface FilterRowProps {
  /** The filter the list is showing. */
  applied: ListFilter;
  /** Writes a new filter to the URL. */
  onChange: (next: ListFilter) => void;
  /** The kinds the group holds; one chip each, and none when only one. */
  present: readonly EntryKind[];
  /** The chip row's own rule for a press — see `toggleKind` in the list. */
  onToggleKind: (kind: EntryKind) => void;
  /** The categories the group has filed something under. */
  used: readonly ExpenseCategory[];
  /** Transactions per category, over the whole group. */
  counts: Readonly<Record<string, number>>;
  firstDate: string | null;
  today: string;
  /** A category's name, as the list names it. */
  nameOf: (category: string) => string;
  /** How many of the sheet's filters are on that this row cannot show. */
  moreCount: number;
  onMore: () => void;
  groupId: string;
  /** Anything that belongs at the end of the row, before Add. */
  trailing?: ReactNode;
  className?: string;
}

/** A menu's trigger: the row's 36px, with a filled state when it narrows. */
function selectStyle(active: boolean): string {
  return cn(
    "tap-target inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
    // The same two states the phone's filter button has: a list narrowed by
    // this control has to look narrowed, and the border and the tint are what
    // carry that — the words stay in the ink that reads on both.
    active
      ? "border-primary bg-primary/15 text-foreground"
      : "border-input bg-card text-foreground hover:bg-muted",
  );
}

export function FilterRow({
  applied,
  onChange,
  present,
  onToggleKind,
  used,
  counts,
  firstDate,
  today,
  nameOf,
  moreCount,
  onMore,
  groupId,
  trailing,
  className,
}: FilterRowProps) {
  const t = useTranslations("expensesList");
  const tf = useTranslations("expensesList.filters");
  const kinds = new Set(applied.kinds);

  return (
    <div className={cn("flex-wrap items-center gap-2", className)}>
      <div className="relative min-w-56 flex-1 basis-56">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={applied.query}
          onChange={(event) =>
            onChange({ ...applied, query: event.target.value })
          }
          aria-label={t("searchLabel")}
          placeholder={t("searchPlaceholder")}
          className="h-9 rounded-xl bg-card pr-9 pl-9 text-base md:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
        {applied.query !== "" && (
          <button
            type="button"
            onClick={() => onChange({ ...applied, query: "" })}
            aria-label={t("clearSearch")}
            className="tap-target absolute top-1/2 right-2.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        )}
      </div>

      {/* The phone's chips, not a segmented control: several can be on at
          once — Expenses and Repayments together is a real question — which
          a segmented row would claim cannot happen. See `toggleKind`. */}
      {present.length > 1 && (
        <div
          role="group"
          aria-label={t("kindFilterLabel")}
          className="flex shrink-0 gap-1.5"
        >
          {present.map((kind) => {
            const on = kinds.has(kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => onToggleKind(kind)}
                aria-pressed={on}
                className={cn(
                  "tap-target h-9 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
                  on
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`kind_${kind}`)}
              </button>
            );
          })}
        </div>
      )}

      <CategoryMenu
        applied={applied}
        onChange={onChange}
        used={used}
        counts={counts}
        nameOf={nameOf}
      />
      <WhenMenu
        applied={applied}
        onChange={onChange}
        firstDate={firstDate}
        today={today}
      />

      <button
        type="button"
        onClick={onMore}
        aria-label={
          moreCount > 0 ? tf("moreWith", { count: moreCount }) : undefined
        }
        className={selectStyle(moreCount > 0)}
      >
        <FilterGlyph
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
        {tf("more")}
        {moreCount > 0 && (
          <span
            aria-hidden="true"
            className="grid min-w-[18px] place-items-center rounded-full bg-primary px-1 text-2xs leading-[18px] font-bold text-primary-foreground tabular-nums"
          >
            {moreCount}
          </span>
        )}
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {trailing}
        <AddExpense groupId={groupId} />
      </div>
    </div>
  );
}

/**
 * Category, as a menu of the categories the group has used.
 *
 * Several at once, as the spine and the sheet allow: each item switches its
 * category in or out and the menu stays open for the next. A category only
 * partly chosen — some of its subcategories, from the sheet — is marked as
 * such, and choosing it takes the whole, which is the sheet's own rule.
 */
function CategoryMenu({
  applied,
  onChange,
  used,
  counts,
  nameOf,
}: {
  applied: ListFilter;
  onChange: (next: ListFilter) => void;
  used: readonly ExpenseCategory[];
  counts: Readonly<Record<string, number>>;
  nameOf: (category: string) => string;
}) {
  const t = useTranslations("expensesList");
  const tf = useTranslations("expensesList.filters");
  const tSub = useSubcategoryLabel();

  const partOf = (category: string) =>
    applied.subcategories.some((pair) => pair.startsWith(`${category}.`));

  // What the group has used, and anything chosen from the sheet's full list
  // besides — a filter that is on must be in the menu that can take it off.
  const shown = EXPENSE_CATEGORY_IDS.filter(
    (category) =>
      used.includes(category) ||
      applied.categories.includes(category) ||
      partOf(category),
  );

  const chosen = [
    ...applied.categories.map(nameOf),
    ...applied.subcategories.map((pair) => {
      const [category = "", leaf = ""] = pair.split(".");
      return tSub(category, leaf);
    }),
  ];
  const value =
    chosen.length === 0
      ? tf("anyCategory")
      : chosen.length === 1
        ? chosen[0]
        : t("bandRemainder", { first: chosen[0], count: chosen.length - 1 });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={tf("categoryMenu", { value })}
        className={selectStyle(chosen.length > 0)}
      >
        <span className="max-w-40 truncate">{value}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuCheckboxItem
          checked={chosen.length === 0}
          onCheckedChange={() => onChange(withoutCategories(applied))}
          className="min-h-9"
        >
          {tf("anyCategory")}
        </DropdownMenuCheckboxItem>
        {shown.length > 0 && <DropdownMenuSeparator />}
        {shown.map((category) => {
          const Glyph = CATEGORY_GLYPHS[category];
          const whole = applied.categories.includes(category);
          return (
            <DropdownMenuCheckboxItem
              key={category}
              checked={
                whole ? true : partOf(category) ? "indeterminate" : false
              }
              onCheckedChange={() => onChange(withCategory(applied, category))}
              // Stays open: the next category is one more press, not one more
              // trip to the trigger.
              onSelect={(event) => event.preventDefault()}
              className="min-h-9 gap-2"
            >
              <Glyph
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 truncate">
                {nameOf(category)}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {counts[category] ?? 0}
              </span>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * When, as a menu: the sheet's three periods, then every month the group has
 * a history in, newest first.
 *
 * A month is the custom range from its first day to its last, so the sheet
 * opens on it with its date fields already filled — the one period both places
 * can show and change. The current month is "This month", and is not listed
 * twice. A range picked in the sheet that is not a whole month is shown as
 * the range it is, so the menu never claims "Any time" over a filtered list.
 */
function WhenMenu({
  applied,
  onChange,
  firstDate,
  today,
}: {
  applied: ListFilter;
  onChange: (next: ListFilter) => void;
  firstDate: string | null;
  today: string;
}) {
  const tf = useTranslations("expensesList.filters");
  const tGroup = useTranslations("group");
  const locale = useLocale();
  const dates = useDateFormatter();

  const current = today.slice(0, 7);
  const month = monthOf(applied);
  // This month is "This month" — unless the sheet's dates happen to cover it
  // exactly, which is a different filter and has to be findable as one.
  const months = monthsBetween(firstDate, today).filter(
    (key) => key !== current || key === month,
  );

  /*
   * A month's name in the reader's language, capitalised as a menu item
   * starts: "July 2026", "Juillet 2026". UTC on both sides, so the first of
   * the month is the first wherever the browser is.
   */
  const monthName = (key: string) => {
    const label = new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(
      Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1),
    );
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  };

  const range = tGroup("metaSpan", {
    first: applied.from ? dates.plain(applied.from) : "…",
    last: applied.to ? dates.plain(applied.to) : "…",
  });

  const selected =
    month !== null
      ? `month:${month}`
      : applied.when === "custom"
        ? "custom"
        : applied.when;

  const value =
    month !== null
      ? monthName(month)
      : applied.when === "custom"
        ? range
        : tf(`when_${applied.when}`);

  const choose = (key: string) => {
    if (key.startsWith("month:")) {
      onChange(withMonth(applied, key.slice("month:".length)));
    } else if (key !== "custom") {
      onChange(withWhen(applied, key as WhenChoice, { firstDate, today }));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={tf("whenMenu", { value })}
        className={selectStyle(applied.when !== "any")}
      >
        {value}
        <ChevronDown
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup value={selected} onValueChange={choose}>
          {(["any", "month", "year"] as const).map((when) => (
            <DropdownMenuRadioItem key={when} value={when} className="min-h-9">
              {tf(`when_${when}`)}
            </DropdownMenuRadioItem>
          ))}
          {selected === "custom" && (
            <DropdownMenuRadioItem value="custom" className="min-h-9">
              {range}
            </DropdownMenuRadioItem>
          )}
          {months.length > 0 && <DropdownMenuSeparator />}
          {months.map((key) => (
            <DropdownMenuRadioItem
              key={key}
              value={`month:${key}`}
              className="min-h-9"
            >
              {monthName(key)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The way to add an expense, at the end of the row.
 *
 * The same route the bar's Add opens — an intercepted one, so the form opens
 * over the table and Back closes it — and the same way round a dropped
 * network: with nothing to answer the route, the form on the device opens
 * instead of the offline shell.
 */
function AddExpense({ groupId }: { groupId: string }) {
  const t = useTranslations("expensesList");
  const online = useOnline();
  const offlineEntry = useOfflineEntry();

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!online && offlineEntry) {
      event.preventDefault();
      offlineEntry.open();
    }
  };

  return (
    <Button asChild size="lg" className="rounded-xl px-3.5 font-semibold">
      <Link href={`/groups/${groupId}/expenses/new`} onClick={onClick}>
        <Plus aria-hidden="true" className="size-4" strokeWidth={2.2} />
        {t("addExpense")}
      </Link>
    </Button>
  );
}
