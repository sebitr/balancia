import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import Decimal from "decimal.js";
import { currencyExponent } from "@/modules/currencies/iso-4217";

/**
 * What a Splitwise export says everybody ends on, read from the file itself.
 *
 * A CSV export closes with a "Total balance" row per currency — the sum of each
 * person's column, positive for someone who gets money back. That row is the
 * one thing in the file the importer never reads, which is what makes it a
 * fair referee: an import whose balances do not land on it has misread a row,
 * however plausible each row looked on its own. A payment read the wrong way
 * round once passed every other test in the suite.
 *
 * A JSON backup carries no summary, so a JSON fixture is held to the CSV export
 * of the same group, which shares its name.
 *
 * Deliberately independent of the adapter: the columns and the summary row are
 * found here by their own, simpler rule, so a mistake in the importer's header
 * handling cannot quietly agree with itself.
 */

const FIXTURE_DIRECTORY = path.join(process.cwd(), "tests/fixtures/splitwise");

const CURRENCY_HEADERS = ["currency", "devise"];
const SUMMARY_LABEL = /^(total balance|solde total)$/i;

/** Every Splitwise export under `tests/fixtures/splitwise`, CSV and JSON. */
export function splitwiseFixtures(): string[] {
  return readdirSync(FIXTURE_DIRECTORY)
    .filter((name) => /\.(csv|json)$/i.test(name))
    .sort();
}

export function readSplitwiseFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIRECTORY, name), "utf8");
}

/**
 * The export's closing balances as `"<currency>|<person>" → minor units`,
 * the same keys a test builds from the imported group.
 */
export function splitwiseTotalBalances(name: string): Record<string, bigint> {
  const csvName = name.replace(/\.json$/i, ".csv");
  const records = parse(readSplitwiseFixture(csvName), {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as string[][];

  const [headers, ...rows] = records;
  const currencyIndex = headers.findIndex((header) =>
    CURRENCY_HEADERS.includes(header.toLowerCase()),
  );
  if (currencyIndex === -1) {
    throw new Error(`${csvName} has no currency column`);
  }
  // Splitwise writes one column per person after the currency.
  const people = headers.slice(currencyIndex + 1);

  const totals: Record<string, bigint> = {};
  for (const row of rows) {
    const isSummary = row
      .slice(0, currencyIndex)
      .some((cell) => SUMMARY_LABEL.test(cell));
    if (!isSummary) continue;

    const currency = row[currencyIndex];
    const scale = new Decimal(10).pow(currencyExponent(currency));
    people.forEach((person, offset) => {
      const cell = row[currencyIndex + 1 + offset] ?? "";
      totals[`${currency}|${person}`] = BigInt(
        new Decimal(cell === "" ? 0 : cell).times(scale).toFixed(0),
      );
    });
  }

  if (Object.keys(totals).length === 0) {
    // A fixture without a summary would pass any balance check vacuously.
    throw new Error(`${csvName} has no Total balance row to check against`);
  }
  return totals;
}
