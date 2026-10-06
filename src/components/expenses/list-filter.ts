import { toneFor } from "@/components/money/balance-tone";
import { minorUnitsPerMajor } from "@/modules/currencies/iso-4217";
import { UNCATEGORISED } from "@/modules/expenses/spread";
import {
  FILTER_PARAM,
  FROM_PARAM,
  KIND_PARAM,
  MAX_PARAM,
  MIN_PARAM,
  PAYER_PARAM,
  POSITION_PARAM,
  PROPERTY_PARAM,
  QUERY_PARAM,
  SORT_PARAM,
  SUB_PARAM,
  TO_PARAM,
  WHEN_PARAM,
  WITH_PARAM,
  type ParamSource,
} from "./list-query";

/**
 * What the transactions list is showing, and the one function that decides it.
 *
 * Three controls narrow this screen — the kind chips, the category spine and
 * the search field — and a fourth, the filter sheet, reaches the axes none of
 * them can. All four write the same object, and this module is the only thing
 * that turns it into rows. A desktop window swaps the spine for a row of menus
 * above its table — a category, a month — and those write the same object
 * too, through the same moves the sheet makes (see "The moves the controls
 * make" below).
 *
 * That matters more than it sounds. The sheet's apply button previews its own
 * outcome ("Show 4 transactions"), and a number counted by a second, similar
 * predicate would eventually disagree with the list it is promising. There is
 * one predicate; the button counts what `selectRows` returns and the list
 * renders it.
 *
 * Everything here is pure, works on plain strings, and knows nothing about
 * React — so the interesting cases are unit tests rather than clicks.
 *
 * ## And its one translation
 *
 * A group whose history the browser has not read to the end is filtered by the
 * server instead, because answering a search from the rows in hand would be
 * answering it about the newest forty. `modules/expenses/transaction-filter.ts`
 * says the same predicate in SQL, reading the filter through `readFilter`,
 * `dateBounds` and `amountBound` below so the parts that can be shared are.
 * The two are held to each other by `tests/integration/transaction-filters`,
 * which runs every axis both ways over one seeded group and compares.
 */

/**
 * One line of the list, as the server builds it.
 *
 * It lives here rather than beside the component that draws it because the
 * predicate below is the thing that has to be told everything: every field
 * added for a new filter is a field this module reads, and the row shape and
 * the questions that can be asked of it are one design.
 */
export interface RowView {
  readonly kind: "expense" | "settlement";
  readonly id: string;
  readonly date: string;
  readonly title: string;
  readonly amount: string;
  readonly currency: string;
  /** The band key this row filters under; null for a settlement. */
  readonly category: string | null;
  /** The second level, when whoever filed it went that far. */
  readonly subcategory: string | null;
  /**
   * What a repayment was for, when whoever recorded it said.
   *
   * An expense puts that in its title, so this is null on one: the description
   * *is* the row. A repayment's title is the two names, which are the fact
   * worth leading with — so its own words go on the line below, beside the
   * date, rather than displacing them.
   */
  readonly note: string | null;
  /**
   * Signed minor units, in the row's display currency; null when it is not
   * ours. On an expense, what it left the reader holding: positive is what
   * they get back. On a repayment, which way the money went for them:
   * positive is what they received, negative what they paid.
   */
  readonly position: string | null;
  readonly revenue: boolean;
  readonly recurring: boolean;
  /**
   * Who put the money in — participant ids, several when a bill was shared.
   *
   * A repayment has exactly one: the person who paid it back.
   */
  readonly payers: readonly string[];
  /**
   * Everybody the row is about — participant ids, each once.
   *
   * On an expense, whoever paid and whoever carries a share of it; on a
   * repayment, both ends. It is what "Entries with Marta" asks of a row, and
   * the order means nothing.
   */
  readonly people: readonly string[];
  /** Recorded in a currency the group does not keep its books in. */
  readonly foreign: boolean;
  /**
   * At least one attachment that has not been deleted.
   *
   * `receipts > 0`, said again: it is what the Only show filter reads, and the
   * API's clients read it under this name, so it stays a field of its own.
   */
  readonly receipt: boolean;
  /** How many attachments it carries that have not been deleted; 0 on a repayment. */
  readonly receipts: number;
  /**
   * Who paid, by name, in the order of `payers`.
   *
   * Names rather than ids for the desktop table's Paid by column, which has to
   * name somebody who has since left the group as readily as somebody still
   * in it — and the people the screen is handed are only the ones still in it.
   */
  readonly payerNames: readonly string[];
  /**
   * How an expense was shared out: the method, and who carries a share of it.
   * Null on a repayment, which is not shared — it moves money between two
   * people, and `method` below is how.
   */
  readonly split: {
    readonly method: "equal" | "exact" | "percentage" | "shares";
    /** Participant ids, each once. */
    readonly sharers: readonly string[];
  } | null;
  /**
   * How a repayment was paid, as recorded: a code from the payment-method
   * catalogue, or the free text an import kept. Null when nobody said, and on
   * an expense.
   */
  readonly method: string | null;
}

/** The periods the When section offers. `any` is the absence of a filter. */
export const WHEN_CHOICES = ["any", "month", "year", "custom"] as const;
export type WhenChoice = (typeof WHEN_CHOICES)[number];

/** The orders the Sort section offers. `newest` is how the server sends them. */
export const SORT_CHOICES = ["newest", "oldest", "largest"] as const;
export type SortChoice = (typeof SORT_CHOICES)[number];

/**
 * What a row left the reader holding.
 *
 * `flat` covers both halves of "nothing for you": a row that settled to zero,
 * and a row that was never theirs at all. The list draws those the same way —
 * neither shows a position under its amount — so the filter groups them too.
 */
export const POSITION_CHOICES = ["owe", "back", "flat"] as const;
export type PositionChoice = (typeof POSITION_CHOICES)[number];

/** The properties the Only show section can require of a row. */
export const PROPERTY_CHOICES = ["series", "foreign", "receipt"] as const;
export type PropertyChoice = (typeof PROPERTY_CHOICES)[number];

/** The three things a row can be, in the order the chips stand in. */
export const KINDS = ["expense", "revenue", "settlement"] as const;
export type EntryKind = (typeof KINDS)[number];

/** Income is stored as an expense running backwards, and filters as its own. */
export function kindOf(row: RowView): EntryKind {
  if (row.kind === "settlement") return "settlement";
  return row.revenue ? "revenue" : "expense";
}

export interface ListFilter {
  /** Whole categories, by the code a row stores. `""` is uncategorised. */
  readonly categories: readonly string[];
  /** `category.subcategory` pairs — a part of a category, not the whole. */
  readonly subcategories: readonly string[];
  readonly kinds: readonly EntryKind[];
  /** What was typed in the search field, unchanged. */
  readonly query: string;
  readonly when: WhenChoice;
  /** `YYYY-MM-DD`, or "". Only meaningful when `when` is `custom`. */
  readonly from: string;
  readonly to: string;
  /** Major units as typed — "12.50", not 1250. Empty means no bound. */
  readonly min: string;
  readonly max: string;
  /** Participant ids. Several mean *any of*. */
  readonly payers: readonly string[];
  /** Participant ids a row must involve. Several mean *any of*. */
  readonly people: readonly string[];
  readonly positions: readonly PositionChoice[];
  readonly properties: readonly PropertyChoice[];
  readonly sort: SortChoice;
}

/** Nothing narrowed and nothing reordered — the list as the server sent it. */
export const NO_FILTER: ListFilter = {
  categories: [],
  subcategories: [],
  kinds: [],
  query: "",
  when: "any",
  from: "",
  to: "",
  min: "",
  max: "",
  payers: [],
  people: [],
  positions: [],
  properties: [],
  sort: "newest",
};

/**
 * The filter the URL is describing.
 *
 * Values that name a choice — the period, the order, the kinds, the positions,
 * the properties — are checked against the vocabulary and dropped when they do
 * not match, because a hand-edited or outdated link must not be able to put
 * the screen into a state its own controls cannot reach or undo. The ends of a
 * custom range are held to the same rule: the date fields can only write a
 * real calendar day, and `from=soon` is not one they could show or clear.
 *
 * Values that name *data* — categories, subcategory pairs, payers, people —
 * are taken as they come. A category the group has never used is a legitimate
 * filter (the sheet offers all eighteen on purpose), and a participant who has
 * since been removed still paid for the rows they paid for.
 */
export function readFilter(source: ParamSource): ListFilter {
  return {
    categories: valuesOf(source, FILTER_PARAM),
    subcategories: valuesOf(source, SUB_PARAM),
    kinds: only(valuesOf(source, KIND_PARAM), KINDS),
    query: first(source, QUERY_PARAM),
    when: one(first(source, WHEN_PARAM), WHEN_CHOICES, "any"),
    from: calendarDay(first(source, FROM_PARAM)),
    to: calendarDay(first(source, TO_PARAM)),
    min: first(source, MIN_PARAM),
    max: first(source, MAX_PARAM),
    payers: valuesOf(source, PAYER_PARAM),
    people: valuesOf(source, WITH_PARAM),
    positions: only(valuesOf(source, POSITION_PARAM), POSITION_CHOICES),
    properties: only(valuesOf(source, PROPERTY_PARAM), PROPERTY_CHOICES),
    sort: one(first(source, SORT_PARAM), SORT_CHOICES, "newest"),
  };
}

/**
 * The filter as search params, in the canonical order `list-query` prints.
 *
 * A dimension that is off writes nothing at all, so the URL of an unfiltered
 * list is the bare path — and two equal filters always produce the same
 * string, which is what `list-place` compares to decide whether a remembered
 * position belongs to the list now on screen.
 */
export function filterParams(
  filter: ListFilter,
  /** Anything on the URL that is not ours — kept, since we did not put it there. */
  base?: URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const name of OWNED_PARAMS) params.delete(name);

  for (const category of filter.categories)
    params.append(FILTER_PARAM, category);
  for (const pair of filter.subcategories) params.append(SUB_PARAM, pair);
  for (const kind of KINDS) {
    if (filter.kinds.includes(kind)) params.append(KIND_PARAM, kind);
  }
  if (filter.query !== "") params.set(QUERY_PARAM, filter.query);
  if (filter.when !== "any") params.set(WHEN_PARAM, filter.when);
  if (filter.when === "custom") {
    if (filter.from !== "") params.set(FROM_PARAM, filter.from);
    if (filter.to !== "") params.set(TO_PARAM, filter.to);
  }
  if (filter.min !== "") params.set(MIN_PARAM, filter.min);
  if (filter.max !== "") params.set(MAX_PARAM, filter.max);
  for (const payer of filter.payers) params.append(PAYER_PARAM, payer);
  for (const person of filter.people) params.append(WITH_PARAM, person);
  for (const position of POSITION_CHOICES) {
    if (filter.positions.includes(position)) {
      params.append(POSITION_PARAM, position);
    }
  }
  for (const property of PROPERTY_CHOICES) {
    if (filter.properties.includes(property)) {
      params.append(PROPERTY_PARAM, property);
    }
  }
  if (filter.sort !== "newest") params.set(SORT_PARAM, filter.sort);

  return params;
}

const OWNED_PARAMS = [
  FILTER_PARAM,
  SUB_PARAM,
  KIND_PARAM,
  QUERY_PARAM,
  WHEN_PARAM,
  FROM_PARAM,
  TO_PARAM,
  MIN_PARAM,
  MAX_PARAM,
  PAYER_PARAM,
  WITH_PARAM,
  POSITION_PARAM,
  PROPERTY_PARAM,
  SORT_PARAM,
] as const;

/**
 * How many dimensions are in use — which is what the button's badge counts.
 *
 * Dimensions, not matches, and not selections: three categories inside the
 * Category section is one filter, because it is one answer to one question.
 * A list that is filtered but looks unfiltered is the failure this number
 * exists to prevent, and a number that grew with every chip would say
 * something else entirely.
 *
 * The search field is not counted. It has its own affordance sitting right
 * beside the button with the reader's own words still in it, so it can say
 * "you are searching" better than a digit can.
 *
 * A non-default sort *is* counted. The list is not in the order it would
 * otherwise be in, and the button is the only thing on the screen that can
 * say so.
 */
export function filterDimensions(filter: ListFilter): number {
  return (
    (filter.when !== "any" ? 1 : 0) +
    (filter.kinds.length > 0 ? 1 : 0) +
    (filter.min !== "" || filter.max !== "" ? 1 : 0) +
    (filter.payers.length > 0 ? 1 : 0) +
    (filter.people.length > 0 ? 1 : 0) +
    (filter.categories.length + filter.subcategories.length > 0 ? 1 : 0) +
    (filter.positions.length > 0 ? 1 : 0) +
    (filter.properties.length > 0 ? 1 : 0) +
    (filter.sort !== "newest" ? 1 : 0)
  );
}

/** Everything the sheet holds, cleared. The search field is not the sheet's. */
export function clearedFilter(filter: ListFilter): ListFilter {
  return { ...NO_FILTER, query: filter.query };
}

/*
 * ## The moves the controls make
 *
 * Two sets of controls write this filter: the sheet a phone opens, and the row
 * of menus a desktop window draws above its table. A choice has to mean the
 * same thing from either — picking Groceries in the desk's Category menu and
 * in the sheet's Category list is one decision, and so is picking a period —
 * so the moves live here, beside the predicate that reads what they write,
 * rather than inside whichever component needed them first. They used to be
 * the sheet's own closures, which is exactly where a second copy would have
 * started to drift from the first.
 */

/** The sections whose chips each switch one value in or out. */
type ToggledField = "kinds" | "payers" | "people" | "positions" | "properties";

/** A multi-select section: the value goes in if it is out, and out if it is in. */
export function toggled<K extends ToggledField>(
  filter: ListFilter,
  field: K,
  value: ListFilter[K][number],
): ListFilter {
  const current = filter[field] as readonly ListFilter[K][number][];
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  return { ...filter, [field]: next };
}

/**
 * A whole category, in or out.
 *
 * Picking the whole thing subsumes whichever parts of it were picked; letting
 * go of it leaves nothing behind either.
 */
export function withCategory(filter: ListFilter, category: string): ListFilter {
  const on = filter.categories.includes(category);
  return {
    ...filter,
    categories: on
      ? filter.categories.filter((code) => code !== category)
      : [...filter.categories, category],
    subcategories: filter.subcategories.filter(
      (pair) => !pair.startsWith(`${category}.`),
    ),
  };
}

/**
 * One part of a category, in or out.
 *
 * A part is not the whole, so choosing one lets the whole go — otherwise the
 * parent would keep every row the part was meant to narrow away.
 */
export function withSubcategory(
  filter: ListFilter,
  category: string,
  leaf: string,
): ListFilter {
  const pair = `${category}.${leaf}`;
  const on = filter.subcategories.includes(pair);
  return {
    ...filter,
    categories: filter.categories.filter((code) => code !== category),
    subcategories: on
      ? filter.subcategories.filter((code) => code !== pair)
      : [...filter.subcategories, pair],
  };
}

/** No category at all, which is what "Any category" asks for. */
export function withoutCategories(filter: ListFilter): ListFilter {
  return { ...filter, categories: [], subcategories: [] };
}

/**
 * A period from the When section.
 *
 * Choosing a custom range fills it with the group's whole history, so the
 * default answer to "which dates?" is one the reader can narrow rather than a
 * pair of empty fields they have to fill before anything happens.
 */
export function withWhen(
  filter: ListFilter,
  when: WhenChoice,
  bounds: { readonly firstDate: string | null; readonly today: string },
): ListFilter {
  if (when !== "custom") return { ...filter, when, from: "", to: "" };
  return {
    ...filter,
    when,
    from: filter.from || (bounds.firstDate ?? ""),
    to: filter.to || bounds.today,
  };
}

/**
 * One calendar month, `YYYY-MM`, as the custom range from its first day to its
 * last — a range the sheet's own date fields can show and change, rather than
 * a fifth kind of period only the desktop's menu knows how to undo.
 */
export function withMonth(filter: ListFilter, month: string): ListFilter {
  return {
    ...filter,
    when: "custom",
    from: `${month}-01`,
    to: `${month}-${lastDayOf(month)}`,
  };
}

/** The month the filter covers exactly, `YYYY-MM`; null for any other period. */
export function monthOf(filter: ListFilter): string | null {
  if (filter.when !== "custom") return null;
  const month = filter.from.slice(0, 7);
  return filter.from === `${month}-01` &&
    filter.to === `${month}-${lastDayOf(month)}`
    ? month
    : null;
}

/**
 * Every month from the one the group's history starts in up to today's,
 * newest first, as `YYYY-MM`. None when the group has no history.
 */
export function monthsBetween(
  firstDate: string | null,
  today: string,
): string[] {
  // A floor that is not a month would never be passed, and the walk below
  // would not stop.
  if (firstDate === null || !/^\d{4}-\d{2}/.test(firstDate)) return [];
  const months: string[] = [];
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const floor = firstDate.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (key < floor) break;
    months.push(key);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

/** The last day of a `YYYY-MM` month, zero-padded: "28" to "31". */
function lastDayOf(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  // Day 0 of the next month is the last day of this one.
  return String(new Date(Date.UTC(year, index, 0)).getUTCDate()).padStart(
    2,
    "0",
  );
}

export interface RowContext {
  /** Today as a calendar date in the group's timezone — what `This month` is measured from. */
  readonly today: string;
  /** A row's date as the reader sees it, so searching can match what is on screen. */
  readonly dateText: (date: string) => string;
}

/**
 * The rows a filter leaves standing, in the order it asks for.
 *
 * Within a section several selections mean *or*; across sections they mean
 * *and*. The one deliberate exception is Only show, whose chips are read as
 * "only show rows that are all of these" — which is what its name promises,
 * and what someone ticking both `From a series` and `With a receipt` is
 * plainly asking for. Read as *or* it would return more rows than either chip
 * alone, from a section called Only show.
 *
 * `rows` must arrive newest-first, which is how the server sends them: that is
 * what makes `newest` free and `oldest` a reversal rather than a second sort.
 */
export function selectRows(
  rows: readonly RowView[],
  filter: ListFilter,
  context: RowContext,
): RowView[] {
  const kinds = new Set<string>(filter.kinds);
  const categories = new Set(filter.categories);
  const pairs = new Set(filter.subcategories);
  const payers = new Set(filter.payers);
  const people = new Set(filter.people);
  const positions = new Set<string>(filter.positions);
  const properties = new Set<string>(filter.properties);
  const byCategory = categories.size > 0 || pairs.size > 0;
  const needle = searchNeedle(filter);
  const { from, to } = dateBounds(filter, context.today);

  const kept = rows.filter((row) => {
    if (kinds.size > 0 && !kinds.has(kindOf(row))) return false;

    if (byCategory) {
      const category = row.category ?? UNCATEGORISED;
      const pair =
        row.subcategory === null ? null : `${category}.${row.subcategory}`;
      if (!categories.has(category) && !(pair !== null && pairs.has(pair))) {
        return false;
      }
    }

    if (from !== "" && row.date < from) return false;
    if (to !== "" && row.date > to) return false;

    if (payers.size > 0 && !row.payers.some((payer) => payers.has(payer))) {
      return false;
    }

    if (people.size > 0 && !row.people.some((person) => people.has(person))) {
      return false;
    }

    if (positions.size > 0 && !positions.has(positionOf(row))) return false;

    if (properties.has("series") && !row.recurring) return false;
    if (properties.has("foreign") && !row.foreign) return false;
    if (properties.has("receipt") && !row.receipt) return false;

    if (!withinAmount(row, filter)) return false;

    if (needle === "") return true;
    return `${row.title} ${row.note ?? ""} ${context.dateText(row.date)}`
      .toLowerCase()
      .includes(needle);
  });

  return sortRows(kept, filter.sort);
}

/**
 * What the search field is looking for, as it is compared: trimmed, and in
 * lower case, against a haystack lowered the same way. No accent folding —
 * "hotel" does not find "Hôtel", on either side of the wire.
 */
export function searchNeedle(filter: ListFilter): string {
  return filter.query.trim().toLowerCase();
}

/**
 * What the row left the reader holding, read the same way the row draws it.
 *
 * Not a second formula: the list prints `row.position` through `toneFor`, and
 * forces a repayment to neutral because a repayment closes a position rather
 * than creating one. A row with no position of ours shows nothing under its
 * amount, and is `flat` here for the same reason.
 */
function positionOf(row: RowView): PositionChoice {
  if (row.position === null || row.kind === "settlement") return "flat";
  const tone = toneFor(row.position);
  if (tone === "positive") return "back";
  if (tone === "negative") return "owe";
  return "flat";
}

/**
 * The first and last dates a row may carry, inclusive; "" where the period
 * has no end on that side.
 *
 * `This month` and `This year` are measured from today *in the group's
 * timezone*, which is the same clock the expense dates were written against —
 * a group in Auckland must not lose the 1st of the month because the server
 * is in UTC.
 */
export function dateBounds(
  filter: ListFilter,
  today: string,
): { from: string; to: string } {
  return {
    from: periodStart(filter, today),
    to: filter.when === "custom" ? filter.to : "",
  };
}

function periodStart(filter: ListFilter, today: string): string {
  switch (filter.when) {
    case "month":
      return `${today.slice(0, 7)}-01`;
    case "year":
      return `${today.slice(0, 4)}-01-01`;
    case "custom":
      return filter.from;
    default:
      return "";
  }
}

/**
 * Whether a row's amount is inside the typed bounds.
 *
 * The bounds are read against *the row's own currency*, so `min 100` is 10 000
 * minor units against EUR and 100 against JPY. Converting the row instead
 * would need an exchange rate nobody chose — the same reason the category
 * spine refuses to rank across currencies.
 */
function withinAmount(row: RowView, filter: ListFilter): boolean {
  const amount = magnitude(row.amount);
  const min = amountBound(filter.min, row.currency);
  if (min !== null && amount < min) return false;
  const max = amountBound(filter.max, row.currency);
  return max === null || amount <= max;
}

/**
 * A typed major-unit bound in the row's minor units, or null when it is not a
 * number yet.
 *
 * Deliberately forgiving where `parseMajorAmount` is strict: this is a filter
 * field being typed into, not an amount being saved. A comma is a decimal
 * point on the keyboard the app is used on, a half-typed "12." is 12, and more
 * decimals than the currency has are cut rather than rejected — a bound that
 * silently switched itself off at the third digit would look like the filter
 * had broken.
 */
export function amountBound(input: string, currency: string): bigint | null {
  const text = input.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(text) || text === "" || text === ".") return null;
  const [whole, fraction = ""] = text.split(".");
  const per = minorUnitsPerMajor(currency);
  const scale = per.toString().length - 1;
  const padded = fraction.slice(0, scale).padEnd(scale, "0");
  return BigInt(whole === "" ? "0" : whole) * per + BigInt(padded || "0");
}

function magnitude(minorUnits: string): bigint {
  const value = BigInt(minorUnits);
  return value < 0n ? -value : value;
}

/**
 * The order, applied last so it sorts what survived rather than what arrived.
 *
 * `largest` compares raw magnitudes, which is only honest inside one currency
 * — see `sortableByAmount`, which is what decides whether the option is
 * offered at all.
 */
function sortRows(rows: readonly RowView[], sort: SortChoice): RowView[] {
  if (sort === "newest") return [...rows];
  if (sort === "oldest") return [...rows].reverse();
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = magnitude(a.row.amount);
      const right = magnitude(b.row.amount);
      // Equal amounts keep the order they came in, which is newest first.
      if (left === right) return a.index - b.index;
      return left < right ? 1 : -1;
    })
    .map((entry) => entry.row);
}

/**
 * Whether `Largest amount` is a question that has an answer here.
 *
 * A group in `separate` mode holds each entry in the currency it was paid in,
 * and there is no rate to compare them by — so 1 000 JPY would sort above
 * 900 EUR, which is not a ranking, it is a coincidence of denominations. The
 * option is withheld rather than answered wrongly, and the section keeps its
 * other two, which mean the same thing in every currency.
 */
export function sortableByAmount(rows: readonly RowView[]): boolean {
  const first = rows[0];
  if (first === undefined) return true;
  return rows.every((row) => row.currency === first.currency);
}

/** Every value under one name, from either shape the filters arrive in. */
function valuesOf(source: ParamSource, name: string): string[] {
  if (typeof (source as URLSearchParams).getAll === "function") {
    return (source as URLSearchParams).getAll(name);
  }
  const value = (source as Record<string, string | string[] | undefined>)[name];
  if (value === undefined) return [];
  return Array.isArray(value) ? [...value] : [value];
}

function first(source: ParamSource, name: string): string {
  return valuesOf(source, name)[0] ?? "";
}

/**
 * `value` when it is a day that exists, written `YYYY-MM-DD`; otherwise "".
 *
 * Checked by building the day and reading it back, so `2026-02-30` — which
 * has the right shape and names no day at all — is dropped with the rest.
 */
function calendarDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) &&
    day.toISOString().slice(0, 10) === value
    ? value
    : "";
}

/** The values that name something in `vocabulary`, in the vocabulary's order. */
function only<T extends string>(
  values: readonly string[],
  vocabulary: readonly T[],
): T[] {
  return vocabulary.filter((choice) => values.includes(choice));
}

function one<T extends string>(
  value: string,
  vocabulary: readonly T[],
  fallback: T,
): T {
  return vocabulary.includes(value as T) ? (value as T) : fallback;
}
