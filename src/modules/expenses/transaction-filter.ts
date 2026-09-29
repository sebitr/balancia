import "server-only";
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Database } from "@/lib/db/client";
import {
  attachments,
  expensePayers,
  expenseShares,
  expenses,
  participants,
  settlements,
} from "@/lib/db/schema";
import type { GroupAccess } from "@/lib/security/authorization";
import { SUPPORTED_CURRENCIES } from "@/modules/currencies/iso-4217";
import {
  amountBound,
  dateBounds,
  KINDS,
  POSITION_CHOICES,
  PROPERTY_CHOICES,
  readFilter,
  searchNeedle,
  SORT_CHOICES,
  WHEN_CHOICES,
  type ListFilter,
} from "@/components/expenses/list-filter";
import { UNCATEGORISED } from "./spread";

/**
 * The transactions list's filter, said in SQL.
 *
 * `selectRows` in `list-filter.ts` is what the filter *means*. It still runs in
 * the browser whenever the browser holds the group's whole history, and this
 * is the same predicate for when it does not: every axis the sheet offers, the
 * kind chips, the spine and the search field, applied by the database so that
 * each page of the list arrives already narrowed, and a search for a 2019
 * hotel costs one page rather than the group's entire past.
 *
 * It is a translation, so it has to be a faithful one, and the cases where
 * that took some doing are written down where they happen:
 *
 *  - **Case.** The browser lowers the search and the row with
 *    `toLowerCase()`. The database's own `lower()` only knows ASCII under the
 *    `C` locale these databases are created with, so "ÉCOLE" would never find
 *    "école". Lowering under `pg_unicode_fast` — PostgreSQL 18's built-in full
 *    Unicode case mapping, present with or without ICU and in the demo
 *    instance's PGlite — agrees with JavaScript, final sigma and dotted İ
 *    included. Accents are not folded on either side: "hotel" does not find
 *    "Hôtel", here or in the browser.
 *  - **Literal text.** The search is a substring test, `strpos`, not a `LIKE`
 *    pattern, so a `%` or a `_` in what was typed is a percent sign and an
 *    underscore and there is nothing to escape.
 *  - **The date as it is shown.** The browser searches a row's date the way
 *    the reader sees it written ("13 Aug 2026", "13/08/2026"), which is
 *    `Intl` in the reader's locale and notation and has no SQL equivalent. So
 *    the days the group has entries on are written out here, in JavaScript,
 *    once per request, and the search matches a day by membership — including
 *    a search that runs off the end of a title and into the date after it.
 *  - **A repayment's title** is a translated sentence around two names. It is
 *    rebuilt in SQL from the same message, with the names as columns.
 *
 * `tests/integration/transaction-filters.test.ts` runs each axis both ways
 * over one seeded group and requires the same rows back.
 */

/**
 * The filter as the transactions endpoint accepts it: the list's own URL
 * parameters, read by the same `readFilter` the screen uses, then bounded.
 *
 * `readFilter` already drops what does not name a choice. What is left to
 * refuse is size — a query string long enough to be a denial of service
 * rather than a question — and the answer to that is a 400, not a silently
 * shortened search.
 */
const filterSchema = z.object({
  categories: z.array(z.string().max(64)).max(64),
  subcategories: z.array(z.string().max(129)).max(256),
  kinds: z.array(z.enum(KINDS)),
  query: z.string().max(200),
  when: z.enum(WHEN_CHOICES),
  from: z.union([z.iso.date(), z.literal("")]),
  to: z.union([z.iso.date(), z.literal("")]),
  min: z.string().max(32),
  max: z.string().max(32),
  payers: z.array(z.string().max(64)).max(64),
  positions: z.array(z.enum(POSITION_CHOICES)),
  properties: z.array(z.enum(PROPERTY_CHOICES)),
  sort: z.enum(SORT_CHOICES),
});

/** The filter these parameters describe, or null when they are out of bounds. */
export function parseTransactionFilter(
  params: URLSearchParams,
): ListFilter | null {
  const parsed = filterSchema.safeParse(readFilter(params));
  return parsed.success ? parsed.data : null;
}

/** Everything the filter is read against, besides the rows themselves. */
export interface FilterScope {
  readonly group: Pick<GroupAccess["group"], "currencyMode" | "baseCurrency">;
  /** Whose position `Your position` is about; null when the reader has none. */
  readonly participantId: string | null;
  /** Today in the group's timezone — what `This month` counts from. */
  readonly today: string;
  /** A repayment's title as the row prints it, from `settlementTitleSql`. */
  readonly settlementTitle: SQL;
  /**
   * Every day the group has an entry on, as the reader sees it written and
   * lower-cased. Only read by a search; `searchableDays` fills it.
   */
  readonly days: ReadonlyMap<string, string>;
}

/**
 * The conditions a filter puts on each table.
 *
 * Null for a table no row of which can survive — a search for settlements
 * only, say, has no expense to find — so the caller can skip asking.
 */
export interface Narrowing {
  readonly expenses: SQL | null;
  readonly settlements: SQL | null;
}

export function narrowing(filter: ListFilter, scope: FilterScope): Narrowing {
  const onExpenses: SQL[] = [];
  const onSettlements: SQL[] = [];
  let expensesPossible = true;
  let settlementsPossible = true;

  // Kind. Income is an expense running backwards, so two of the three kinds
  // are one table read two ways.
  if (filter.kinds.length > 0) {
    const spending = filter.kinds.includes("expense");
    const income = filter.kinds.includes("revenue");
    if (!spending && !income) expensesPossible = false;
    else if (!income) onExpenses.push(eq(expenses.direction, "out"));
    else if (!spending) onExpenses.push(ne(expenses.direction, "out"));
    if (!filter.kinds.includes("settlement")) settlementsPossible = false;
  }

  // Category. A row with no category files under the empty key — and so does
  // every repayment, which is why asking for Uncategorised shows them too.
  if (filter.categories.length + filter.subcategories.length > 0) {
    const key = sql`coalesce(${expenses.category}, ${UNCATEGORISED})`;
    const either: SQL[] = [];
    if (filter.categories.length > 0) {
      either.push(inArray(key, [...filter.categories]));
    }
    if (filter.subcategories.length > 0) {
      either.push(
        and(
          isNotNull(expenses.subcategory),
          inArray(sql`${key} || '.' || ${expenses.subcategory}`, [
            ...filter.subcategories,
          ]),
        )!,
      );
    }
    onExpenses.push(or(...either)!);
    if (!filter.categories.includes(UNCATEGORISED)) {
      settlementsPossible = false;
    }
  }

  // When. Real dates rather than text, so the list's own index can stop at
  // the start of the month instead of reading on to the group's first day.
  const { from, to } = dateBounds(filter, scope.today);
  if (from !== "") {
    onExpenses.push(gte(expenses.expenseDate, from));
    onSettlements.push(gte(settlements.settledOn, from));
  }
  if (to !== "") {
    onExpenses.push(lte(expenses.expenseDate, to));
    onSettlements.push(lte(settlements.settledOn, to));
  }

  // Paid by, any of. An id that is not one — the browser compares strings, so
  // it simply never matches — cannot be handed to a uuid column; it is left
  // out, and a filter made only of those matches nothing, as it does there.
  if (filter.payers.length > 0) {
    const ids = filter.payers.filter((id) => PARTICIPANT_ID.test(id));
    if (ids.length === 0) {
      expensesPossible = false;
      settlementsPossible = false;
    } else {
      onExpenses.push(
        sql`EXISTS (SELECT 1 FROM ${expensePayers} WHERE ${expensePayers.expenseId} = ${expenses.id} AND ${inArray(expensePayers.participantId, ids)})`,
      );
      onSettlements.push(inArray(settlements.fromParticipantId, ids));
    }
  }

  // Your position. A repayment is always nothing for you; an expense is what
  // the row prints under its amount, signed the way the row signs it.
  if (filter.positions.length > 0) {
    const wanted = new Set(filter.positions);
    if (!wanted.has("flat")) settlementsPossible = false;
    const position = positionSql(scope);
    if (position === null) {
      // No reader in the group, so no row is theirs: every one is flat.
      if (!wanted.has("flat")) expensesPossible = false;
    } else if (wanted.size < POSITION_CHOICES.length) {
      const either: SQL[] = [];
      if (wanted.has("back")) either.push(sql`${position} > 0`);
      if (wanted.has("owe")) either.push(sql`${position} < 0`);
      if (wanted.has("flat")) either.push(sql`${position} = 0`);
      onExpenses.push(or(...either)!);
    }
  }

  // Only show — every chip at once, as the section promises.
  if (filter.properties.includes("series")) {
    onExpenses.push(isNotNull(expenses.recurringExpenseId));
    settlementsPossible = false;
  }
  if (filter.properties.includes("receipt")) {
    onExpenses.push(
      sql`EXISTS (SELECT 1 FROM ${attachments} WHERE ${attachments.expenseId} = ${expenses.id} AND ${attachments.deletedAt} IS NULL)`,
    );
    // A repayment carries no attachments; there is no table for them.
    settlementsPossible = false;
  }
  if (filter.properties.includes("foreign")) {
    const base = scope.group.baseCurrency;
    if (base === null) {
      // Nothing to differ from, so nothing is foreign.
      expensesPossible = false;
      settlementsPossible = false;
    } else {
      onExpenses.push(ne(expenses.currency, base));
      onSettlements.push(ne(settlements.currency, base));
    }
  }

  // Amount, against each row's own currency, and both ends inclusive.
  const minimum = boundsByExponent(filter.min);
  const maximum = boundsByExponent(filter.max);
  for (const [table, conditions] of [
    [expenses, onExpenses],
    [settlements, onSettlements],
  ] as const) {
    const money = displayMoneySql(table, scope.group);
    if (minimum !== null) {
      conditions.push(
        sql`abs(${money.amount}) >= ${boundSql(money.currency, minimum)}`,
      );
    }
    if (maximum !== null) {
      conditions.push(
        sql`abs(${money.amount}) <= ${boundSql(money.currency, maximum)}`,
      );
    }
  }

  // The search field.
  const needle = searchNeedle(filter);
  if (needle !== "") {
    // `${title} ${note ?? ""}`, which for an expense is its description and a
    // space: its own notes stay on its detail screen, and are not searched.
    onExpenses.push(
      searchSql(
        needle,
        sql`${expenses.description} || ' '`,
        expenses.expenseDate,
        scope.days,
      ),
    );
    onSettlements.push(
      searchSql(
        needle,
        sql`${scope.settlementTitle} || ' ' || coalesce(${settlements.notes}, '')`,
        settlements.settledOn,
        scope.days,
      ),
    );
  }

  return {
    expenses: expensesPossible ? (and(...onExpenses) ?? sql`true`) : null,
    settlements: settlementsPossible
      ? (and(...onSettlements) ?? sql`true`)
      : null,
  };
}

/**
 * How participant ids are written. Lower case only: the browser matches ids
 * as strings, and an upper-case spelling of a real id matches nothing there.
 */
const PARTICIPANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * What an expense left the reader holding, as a signed number of minor units.
 *
 * `positionOf` in `transactions.ts`, in SQL: paid minus owed, from the stored
 * allocations, in the amount `allocationForGroup` picks, signed by direction.
 * Only its sign is read. An expense the reader neither paid nor shares in
 * comes out as zero, which is `flat` — the same bucket the browser puts a row
 * with no position in.
 */
function positionSql(scope: FilterScope): SQL | null {
  const self = scope.participantId;
  if (self === null) return null;
  const converted = scope.group.currencyMode === "converted";

  const held = (table: typeof expensePayers | typeof expenseShares) => {
    const allocation = converted
      ? sql`coalesce(${table.convertedAmount}, ${table.amount})`
      : sql`${table.amount}`;
    return sql`coalesce((SELECT sum(${allocation}) FROM ${table} WHERE ${table.expenseId} = ${expenses.id} AND ${table.participantId} = ${self}), 0)`;
  };

  return sql`(CASE WHEN ${expenses.direction} = 'out' THEN 1 ELSE -1 END) * (${held(expensePayers)} - ${held(expenseShares)})`;
}

/**
 * The amount and currency a row is listed in, in SQL.
 *
 * `moneyForGroup` is the rule, and this repeats it for the two places a
 * filter needs it inside the query: the amount bounds, and the largest-first
 * order. The converted figure in a converted group, the original everywhere
 * else. If `moneyForGroup` changes which currency a row counts under, this
 * has to change with it — the amount-bound case in the integration test seeds
 * an unconverted foreign row in a converted group so that a divergence fails
 * there rather than in somebody's filter.
 */
export function displayMoneySql(
  table: typeof expenses | typeof settlements,
  group: FilterScope["group"],
): { amount: SQL; currency: SQL } {
  if (group.currencyMode === "separate") {
    return { amount: sql`${table.amount}`, currency: sql`${table.currency}` };
  }
  return {
    amount: sql`coalesce(${table.convertedAmount}, ${table.amount})`,
    currency:
      group.baseCurrency === null
        ? sql`coalesce(${table.convertedCurrency}, ${table.currency})`
        : sql`coalesce(${table.convertedCurrency}, ${group.baseCurrency}::text, ${table.currency})`,
  };
}

/** Every currency the app supports, by how many minor-unit digits it has. */
const CODES_BY_EXPONENT: ReadonlyMap<number, readonly string[]> = (() => {
  const byExponent = new Map<number, string[]>();
  for (const { code, exponent } of SUPPORTED_CURRENCIES) {
    byExponent.set(exponent, [...(byExponent.get(exponent) ?? []), code]);
  }
  return byExponent;
})();

/**
 * A typed bound in the minor units of each exponent a currency can have — the
 * same `amountBound` the browser runs, once per exponent rather than once per
 * row — or null when what was typed is not a number yet.
 */
function boundsByExponent(input: string): ReadonlyMap<number, bigint> | null {
  const bounds = new Map<number, bigint>();
  for (const [exponent, codes] of CODES_BY_EXPONENT) {
    const bound = amountBound(input, codes[0]);
    if (bound === null) return null;
    bounds.set(exponent, bound);
  }
  return bounds;
}

/** The bound that applies to a row, picked by its currency's exponent. */
function boundSql(currency: SQL, bounds: ReadonlyMap<number, bigint>): SQL {
  const branches = [...bounds].map(
    ([exponent, bound]) =>
      sql`WHEN ${currency} = ANY(${sql.param(CODES_BY_EXPONENT.get(exponent))}::text[]) THEN ${bound.toString()}::bigint`,
  );
  return sql`(CASE ${sql.join(branches, sql` `)} END)`;
}

/**
 * Whether `needle` occurs in `text + " " + day`, lower-cased, where the day is
 * written the way the reader sees it.
 *
 * The day cannot be written in SQL, so the test is taken apart at the one
 * space that joins the two halves. A needle can sit wholly in the text, which
 * is `strpos`; wholly in the day, which is a set of days computed here; or
 * across the join, in which case it splits at one of its own spaces into the
 * end of the text and the start of the day. Each such split is one more pair
 * of conditions, and a needle has few spaces.
 *
 * `needle` arrives trimmed, so it neither starts nor ends at the join itself.
 */
function searchSql(
  needle: string,
  text: SQL,
  day: AnyPgColumn,
  days: ReadonlyMap<string, string>,
): SQL {
  const lowered = sql`lower((${text}) COLLATE pg_unicode_fast)`;
  const either: SQL[] = [sql`strpos(${lowered}, ${needle}) > 0`];

  const inside = daysWhere(days, (written) => written.includes(needle));
  if (inside.length > 0) either.push(onDays(day, inside));

  for (
    let space = needle.indexOf(" ");
    space !== -1;
    space = needle.indexOf(" ", space + 1)
  ) {
    const head = needle.slice(0, space);
    const tail = needle.slice(space + 1);
    const starting = daysWhere(days, (written) => written.startsWith(tail));
    if (starting.length === 0) continue;
    // `right` counts characters, so the length is counted in code points.
    either.push(
      and(
        sql`right(${lowered}, ${[...head].length}) = ${head}`,
        onDays(day, starting),
      )!,
    );
  }

  return or(...either)!;
}

function daysWhere(
  days: ReadonlyMap<string, string>,
  test: (written: string) => boolean,
): string[] {
  const matching: string[] = [];
  for (const [day, written] of days) if (test(written)) matching.push(day);
  return matching;
}

/** One array parameter, however many days — never a parameter per day. */
function onDays(day: AnyPgColumn, dates: readonly string[]): SQL {
  return sql`${day} = ANY(${sql.param(dates)}::date[])`;
}

/**
 * Every day the group has an entry on, written for this reader.
 *
 * One query for the dates and one formatter call per date — a few hundred for
 * most groups, and at worst one per day of the group's life.
 */
export async function searchableDays(
  db: Database,
  groupId: string,
  dateText: (date: string) => string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ day: expenses.expenseDate })
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .union(
      db
        .select({ day: settlements.settledOn })
        .from(settlements)
        .where(
          and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt)),
        ),
    );

  const days = new Map<string, string>();
  for (const { day } of rows) days.set(day, dateText(day).toLowerCase());
  return days;
}

const FROM_MARK = "";
const TO_MARK = "";

/**
 * A repayment's title in SQL, built from the message the row prints.
 *
 * The message is rendered once with two private-use characters standing in
 * for the names, and cut around them: what is left are the translator's own
 * words, which go in as parameters, and the two holes are filled with the
 * names looked up the way `listSettlements` looks them up — within the group,
 * and "Unknown" when there is no such person.
 */
export function settlementTitleSql(
  render: (names: { from: string; to: string }) => string,
): SQL {
  const nameOf = (id: AnyPgColumn) =>
    sql`coalesce((SELECT ${participants.displayName} FROM ${participants} WHERE ${participants.id} = ${id} AND ${participants.groupId} = ${settlements.groupId}), ${"Unknown"}::text)`;

  const pieces = render({ from: FROM_MARK, to: TO_MARK })
    .split(/(|)/)
    .filter((piece) => piece !== "")
    .map((piece) =>
      piece === FROM_MARK
        ? nameOf(settlements.fromParticipantId)
        : piece === TO_MARK
          ? nameOf(settlements.toParticipantId)
          : sql`${piece}::text`,
    );

  return pieces.length === 0 ? sql`''` : sql.join(pieces, sql` || `);
}
