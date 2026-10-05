import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { keysetTime } from "@/lib/db/keyset";

/**
 * Optimistic concurrency for an entry that is edited by replacing it whole.
 *
 * An edit of an expense or a repayment rewrites every field, so two people
 * with the same entry open used to be a race nobody was told about: the second
 * save put back everything the first had just corrected. Both edits reached
 * the activity log, and neither person learned the other had been there.
 *
 * So an edit may carry the version of the entry it was made from, and the
 * write only lands while that is still the version stored. Anything else means
 * somebody changed the entry in between, and the edit is refused rather than
 * applied on top of a row its author never saw.
 *
 * ## The version is `updated_at`, spelled as text
 *
 * The column is already stamped on every edit, so no migration is needed. It
 * travels as the same fixed-width UTC string the list cursors use — see
 * `@/lib/db/keyset` — for the same reason: PostgreSQL keeps microseconds and a
 * JavaScript `Date` keeps milliseconds, so a version round-tripped through a
 * `Date` would never compare equal to the one it came from. As text it is
 * compared exactly, and a caller treats it as an opaque token.
 */

/** The row's current version, for `select()` and `returning()`. */
export function entryVersion(column: AnyPgColumn): SQL<string> {
  return keysetTime(column);
}

/**
 * Whether the stored version is still the one the edit was made from.
 *
 * Compared as text rather than cast back to a timestamp, so a token that is
 * not one of ours simply fails to match — a stale version and a garbled one
 * are the same answer — instead of raising a cast error in the middle of a
 * write.
 */
export function versionIs(column: AnyPgColumn, expected: string): SQL {
  return sql`${entryVersion(column)} = ${expected}`;
}

/**
 * The version an edit stamps: the database's clock, and never the one before.
 *
 * Written by the database rather than as `new Date()` from the application.
 * A version is only worth checking if every edit moves it, and a JavaScript
 * clock has a millisecond's resolution — two saves inside one millisecond
 * would leave the same version behind them, and a third editor holding it
 * would overwrite the second without being refused. The `+ 1 microsecond`
 * floor also keeps it moving forward when the transaction's clock is behind
 * the stamp already there.
 */
export function nextVersion(column: AnyPgColumn): SQL {
  return sql`greatest(now(), ${column} + interval '1 microsecond')`;
}

/**
 * Somebody else changed this entry after it was opened for editing.
 *
 * Nothing was written. The reader's own changes are still theirs to keep or
 * reapply, which is why the refusal says what happened rather than merging —
 * two corrections to one amount have no right answer a server could pick.
 */
export class EditConflictError extends Error {
  /** Maps to `serverErrors.editConflict` — see `@/lib/server-errors`. */
  readonly code = "editConflict";

  constructor(
    message = "Somebody else changed this entry since you opened it, so your changes were not saved. Reload it to see their version.",
  ) {
    super(message);
    this.name = "EditConflictError";
  }
}
