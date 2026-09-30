import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { isStorableDate } from "@/lib/calendar-date";

/**
 * Keyset paging over a list ordered by (date, created_at, id) descending.
 *
 * `LIMIT`/`OFFSET` is the obvious way to page and the wrong one here. It
 * re-reads and discards every row before the offset, so page forty costs forty
 * pages of work; and because the sort key is not unique it is not even
 * correct — an import writes hundreds of rows inside one transaction, and
 * Postgres' `now()` is the *transaction's* clock, so all of them share a
 * created_at to the microsecond. Ordering with no tie-break lets the database
 * return those in a different arrangement per query, which at a page boundary
 * shows one row twice and hides another entirely.
 *
 * So the cursor is the sort key of the last row handed out, `id` is part of it
 * to make the key unique, and the next page is everything strictly below it.
 * Cost is constant per page, and a row added or deleted while the reader
 * scrolls shifts nothing underneath them.
 *
 * ## Why the time is carried as text
 *
 * A Postgres timestamptz holds microseconds; a JavaScript `Date` holds
 * milliseconds. Round-tripping the cursor through a `Date` therefore rounds it
 * *down*, and a cursor of `12:00:00.123` would skip every row between
 * `.123000` and the `.123456` it came from. `keysetTime` renders the column to
 * a fixed-width UTC string instead — six fractional digits, always — which
 * survives the trip in both directions and compares lexicographically in the
 * same order it compares chronologically.
 *
 * ## The other two orders
 *
 * The transactions list can also be read oldest first, and largest first.
 * Oldest first is the same key walked from the other end (`keysetAfter`).
 * Largest first puts the amount in front of it (`keysetBeforeAmount`), and the
 * cursor then carries that amount as a fourth part — the date, the clock and
 * the id still follow it, because two rows of the same amount are the common
 * case, not the corner one.
 */

export interface ListCursor {
  /** The calendar date the row is filed under, `YYYY-MM-DD`. */
  readonly date: string;
  /** Creation instant, UTC, microsecond precision — see above. */
  readonly time: string;
  readonly id: string;
  /**
   * The row's magnitude in minor units, for a list ranked by amount first.
   * Absent from every cursor over a chronological list.
   */
  readonly amount?: string;
}

const TIME_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/**
 * Both halves are cast by PostgreSQL, which refuses a day or an hour that does
 * not exist — so the shape is not enough here either, and a cursor fiddled to
 * `2025-02-30` would otherwise fail the query rather than read as no cursor.
 */
const cursorSchema = z.object({
  date: z.string().refine(isStorableDate),
  time: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/)
    .refine((value) => isStorableDate(value.slice(0, 10))),
  id: z.uuid(),
  // Nineteen digits is the whole of a bigint; anything longer is not an
  // amount this server could have written.
  amount: z
    .string()
    .regex(/^\d{1,19}$/)
    .optional(),
});

/** The creation instant as the cursor spells it, for `select()`. */
export function keysetTime(column: AnyPgColumn): SQL<string> {
  return sql<string>`to_char(${column} AT TIME ZONE 'UTC', ${TIME_FORMAT})`;
}

/**
 * Everything strictly after `cursor` in a descending list.
 *
 * A row constructor rather than three chained comparisons: `(a, b, c) < (x, y,
 * z)` is one expression Postgres can answer from a multicolumn index, where
 * the unrolled `a < x OR (a = x AND ...)` form is three, and easy to get
 * subtly wrong.
 */
export function keysetBefore(
  columns: {
    readonly date: AnyPgColumn;
    readonly time: AnyPgColumn;
    readonly id: AnyPgColumn;
  },
  cursor: ListCursor,
): SQL {
  return sql`(${columns.date}, ${columns.time}, ${columns.id}) < (${cursor.date}::date, ${cursor.time}::timestamptz, ${cursor.id}::uuid)`;
}

/** Everything strictly after `cursor` in an ascending list: oldest first. */
export function keysetAfter(
  columns: {
    readonly date: AnyPgColumn;
    readonly time: AnyPgColumn;
    readonly id: AnyPgColumn;
  },
  cursor: ListCursor,
): SQL {
  return sql`(${columns.date}, ${columns.time}, ${columns.id}) > (${cursor.date}::date, ${cursor.time}::timestamptz, ${cursor.id}::uuid)`;
}

/**
 * Everything strictly after `cursor` in a list ranked by `amount` descending,
 * and newest first among equal amounts. One row constructor again, with the
 * amount leading it.
 */
export function keysetBeforeAmount(
  amount: SQL,
  columns: {
    readonly date: AnyPgColumn;
    readonly time: AnyPgColumn;
    readonly id: AnyPgColumn;
  },
  cursor: ListCursor & { readonly amount: string },
): SQL {
  return sql`(${amount}, ${columns.date}, ${columns.time}, ${columns.id}) < (${cursor.amount}::bigint, ${cursor.date}::date, ${cursor.time}::timestamptz, ${cursor.id}::uuid)`;
}

/**
 * The cursor as one URL-safe token.
 *
 * Opaque by convention rather than by encryption: it names a position in a
 * list the caller is already authorized to read, and every request carrying
 * one is authorized again from scratch. `|` is the separator because no part
 * can contain it — two fixed formats, a UUID and, when there is one, a run of
 * digits.
 */
export function encodeCursor(cursor: ListCursor): string {
  const key = `${cursor.date}|${cursor.time}|${cursor.id}`;
  return cursor.amount === undefined ? key : `${key}|${cursor.amount}`;
}

/** Null for anything this did not write; the caller then starts at the top. */
export function decodeCursor(
  raw: string | null | undefined,
): ListCursor | null {
  if (!raw) return null;
  const parts = raw.split("|");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [date, time, id, amount] = parts;
  const parsed = cursorSchema.safeParse({ date, time, id, amount });
  if (!parsed.success) return null;
  const { amount: magnitude, ...key } = parsed.data;
  return magnitude === undefined ? key : { ...key, amount: magnitude };
}

/** Descending by date, then by creation, then by id — the order it all pages in. */
export function compareKeysDesc(
  a: { readonly date: string; readonly time: string; readonly id: string },
  b: { readonly date: string; readonly time: string; readonly id: string },
): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.time !== b.time) return a.time < b.time ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}
