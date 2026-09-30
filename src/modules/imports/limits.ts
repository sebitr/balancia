import type { ImportWarning, ParsedImport, StagedRow } from "./types";

/**
 * What an imported row has to fit before it is staged.
 *
 * An adapter reads a file. It does not know what the database will refuse at
 * commit, or what the forms will refuse the first time somebody edits the
 * row, and a file is under no obligation to respect either. The limits here
 * are checked at staging, so whatever does not fit is in the preview before
 * anything is written — a row the database throws out at commit is a row
 * nobody was warned about.
 *
 * Pure and framework-free: the import wizard reads the file ceiling from here
 * too, to refuse an oversized file before sending it.
 */

/**
 * The largest file one import reads, in bytes.
 *
 * The file travels to the server in a Server Action, and `next.config.ts` caps
 * an action's whole request body at 1 MB (`serverActions.bodySizeLimit`, which
 * is 1,048,576 bytes). Next has no per-action limit, so a higher ceiling here
 * was a promise the framework broke first: a file between 1 and 10 MiB died
 * in a framework error before a line of this code ran. A million bytes leaves
 * the difference for the multipart framing around the file, and
 * `limits.test.ts` fails if the two ever stop agreeing.
 */
export const MAX_IMPORT_BYTES = 1_000_000;

/**
 * The largest amount an import stages, in minor units.
 *
 * The expense form's own ceiling (`minorUnitsString`), which also keeps every
 * amount well inside the `bigint` columns that would otherwise refuse the row
 * at commit.
 */
export const MAX_IMPORT_MINOR_UNITS = 10n ** 18n;

/**
 * The longest text the forms accept, field by field.
 *
 * An imported row is an ordinary entry once it lands, and the first time
 * somebody opens it to fix an amount it goes through those forms. Text longer
 * than they allow would make the row unsavable until it was cut by hand, so it
 * is cut here instead — with a warning, and never by dropping the row: a
 * description is not worth losing somebody's money from the balances over.
 */
export const IMPORT_TEXT_LIMITS = {
  description: 200,
  notes: 2000,
  category: 60,
  displayName: 120,
} as const;

/**
 * How many source names one participant mapping may carry.
 *
 * A mapping is checked name by name against the run it belongs to; this only
 * bounds the work before that check can start. A Splitwise export names the
 * people of one group, and a whole account's JSON backup rarely more than a
 * few dozen.
 */
export const MAX_MAPPED_NAMES = 1000;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Whether a `YYYY-MM-DD` string names a day that exists.
 *
 * A pattern lets `2024-02-30` through and PostgreSQL refuses it at commit. Year
 * 0 is refused as well: PostgreSQL counts from 1 BC straight to 1 AD, so
 * `0000-01-01` is not a date it will store.
 */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const last = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1];
  return day <= last;
}

/**
 * Cuts text to `limit` characters, marking the cut with an ellipsis.
 *
 * Counted the way the forms count (UTF-16 code units, as zod's `max` does),
 * and never through the middle of a surrogate pair, which would leave half an
 * emoji behind.
 */
export function fitText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  let cut = value.slice(0, limit - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

export interface FittedRow {
  readonly rowNumber: number;
  /** What gets staged and, later, written. */
  readonly row: StagedRow;
  /**
   * The row exactly as the adapter read it. The fingerprint is taken from this
   * one: shortening a description must not make a row that was imported
   * before this check existed look new to a retry, and import it twice.
   */
  readonly source: StagedRow;
}

/** Every amount a row would write, as the adapter staged it. */
function amountsOf(row: StagedRow): string[] {
  return row.kind === "expense"
    ? [
        row.amount,
        ...row.payers.map((payer) => payer.amount),
        ...row.shares.map((share) => share.amount),
      ]
    : [row.amount];
}

function outOfRange(amount: string): boolean {
  const value = BigInt(amount);
  return value > MAX_IMPORT_MINOR_UNITS || value < -MAX_IMPORT_MINOR_UNITS;
}

/**
 * Holds a parsed file to the limits above.
 *
 * A row with an amount too large to record is dropped with a warning, like any
 * other row an adapter cannot use. Text longer than the forms allow is
 * shortened with a warning. A participant name is not shortened here — it is
 * the key the mapping and the fingerprint are built on — but the preview says
 * it will be, and the commit cuts it when it creates the person.
 */
export function fitToImportLimits(parsed: ParsedImport): {
  rows: FittedRow[];
  warnings: ImportWarning[];
} {
  const warnings: ImportWarning[] = [];
  const rows: FittedRow[] = [];

  for (const participant of parsed.participants) {
    if (participant.sourceName.length > IMPORT_TEXT_LIMITS.displayName) {
      warnings.push({
        rowNumber: null,
        message: `A name longer than ${IMPORT_TEXT_LIMITS.displayName} characters is shortened if the person is added as new`,
        detail: participant.sourceName.slice(0, 60),
      });
    }
  }

  for (const { rowNumber, row } of parsed.rows) {
    const tooLarge = amountsOf(row).find(outOfRange);
    if (tooLarge !== undefined) {
      warnings.push({
        rowNumber,
        message: "Skipped a row with an amount too large to record",
        detail: tooLarge.slice(0, 60),
      });
      continue;
    }

    const shorten = (
      value: string | null | undefined,
      limit: number,
      what: string,
    ): string | null | undefined => {
      if (value === null || value === undefined || value.length <= limit) {
        return value;
      }
      warnings.push({
        rowNumber,
        message: `Shortened ${what} longer than ${limit.toLocaleString("en")} characters`,
      });
      return fitText(value, limit);
    };

    const fitted: StagedRow =
      row.kind === "expense"
        ? {
            ...row,
            description:
              shorten(
                row.description,
                IMPORT_TEXT_LIMITS.description,
                "a description",
              ) ?? row.description,
            notes: shorten(row.notes, IMPORT_TEXT_LIMITS.notes, "a note"),
            category: shorten(
              row.category,
              IMPORT_TEXT_LIMITS.category,
              "a category",
            ),
          }
        : {
            ...row,
            notes: shorten(row.notes, IMPORT_TEXT_LIMITS.notes, "a note"),
          };

    rows.push({ rowNumber, row: fitted, source: row });
  }

  return { rows, warnings };
}
