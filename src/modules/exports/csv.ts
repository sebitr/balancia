/**
 * CSV serialisation for exports.
 *
 * Two hazards drive the design, and both are about what happens *after* the
 * file leaves Balancia:
 *
 *  1. **Formula injection.** A description a group member typed becomes a cell
 *     in someone else's spreadsheet. A leading `=`, `+`, `-`, `@`, tab or
 *     carriage return makes Excel and LibreOffice treat it as a formula, which
 *     is a code-execution path in a file that looks like data. Every text cell
 *     is neutralised.
 *  2. **Encoding.** Without a byte-order mark, Excel on Windows reads the file
 *     as the local codepage and turns "Amélie" into mojibake. The BOM plus
 *     CRLF line endings is what makes a CSV open correctly by double-click.
 */

const BOM = "\uFEFF";
const CRLF = "\r\n";

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Prefixes a single quote when the value would otherwise be read as a formula.
 *
 * The quote is the convention spreadsheets understand as "this is text"; it is
 * not displayed in the cell.
 */
export function neutralizeFormula(value: string): string {
  return FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix))
    ? `'${value}`
    : value;
}

/** Quotes a field if it contains a delimiter, quote or newline. */
export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";

  // Numbers are ours, not user input: they need no formula neutralisation, and
  // quoting them would stop a spreadsheet reading them as numbers.
  const text =
    typeof value === "number" ? String(value) : neutralizeFormula(value);

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Renders rows as a CSV document, with the BOM and CRLF endings that make it
 * open correctly by double-click on every desktop spreadsheet.
 */
export function toCsv(
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return BOM + rows.map((row) => row.map(escapeCsvField).join(",")).join(CRLF);
}
