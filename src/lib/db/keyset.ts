import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

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
 */

export interface ListCursor {
  /** The calendar date the row is filed under, `YYYY-MM-DD`. */
  readonly date: string;
  /** Creation instant, UTC, microsecond precision — see above. */
  readonly time: string;
  readonly id: string;
}

const TIME_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

const cursorSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  id: z.uuid(),
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

/**
 * The cursor as one URL-safe token.
 *
 * Opaque by convention rather than by encryption: it names a position in a
 * list the caller is already authorized to read, and every request carrying
 * one is authorized again from scratch. `|` is the separator because no part
 * can contain it — two fixed formats and a UUID.
 */
export function encodeCursor(cursor: ListCursor): string {
  return `${cursor.date}|${cursor.time}|${cursor.id}`;
}

/** Null for anything this did not write; the caller then starts at the top. */
export function decodeCursor(
  raw: string | null | undefined,
): ListCursor | null {
  if (!raw) return null;
  const [date, time, id] = raw.split("|");
  const parsed = cursorSchema.safeParse({ date, time, id });
  return parsed.success ? parsed.data : null;
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
