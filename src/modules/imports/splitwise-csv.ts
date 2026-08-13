import { parse } from "csv-parse/sync";
import Decimal from "decimal.js";
import {
  currencyExponent,
  isSupportedCurrency,
} from "@/modules/currencies/iso-4217";
import {
  ImportParseError,
  type ImportAdapter,
  type ImportWarning,
  type ParsedImport,
  type StagedParticipant,
  type StagedRow,
  type StagedShare,
} from "./types";

/**
 * Splitwise per-group CSV adapter.
 *
 * Splitwise's spreadsheet export is a wide table: fixed leading columns
 * (Date, Description, Category, Cost, Currency) followed by one column per
 * person, holding that person's signed net position for the row. Positive
 * means they are owed (they paid more than their share); negative means they
 * owe.
 *
 * Exports differ across years and locales, so nothing is assumed positionally:
 * headers are detected by name with several known aliases, the person columns
 * are whatever is left, and a trailing "Total balance" summary row is dropped.
 * Rows that cannot be understood become warnings rather than failing the file.
 */

const DATE_HEADERS = ["date", "fecha", "datum", "data"];
const DESCRIPTION_HEADERS = [
  "description",
  "descripción",
  "descripcion",
  "beschreibung",
  "descrizione",
];
const CATEGORY_HEADERS = ["category", "categoría", "categoria", "kategorie"];
const COST_HEADERS = ["cost", "amount", "coste", "costo", "betrag", "importo"];
const CURRENCY_HEADERS = ["currency", "moneda", "währung", "wahrung", "valuta"];

/** Non-person trailing columns some exports include. */
const IGNORED_HEADERS = ["", "total", "balance", "total balance", "saldo"];

function findHeader(
  headers: readonly string[],
  candidates: readonly string[],
): number {
  return headers.findIndex((header) =>
    candidates.includes(header.trim().toLowerCase()),
  );
}

/** Splitwise marks repayments with this description. */
const SETTLEMENT_DESCRIPTIONS = new Set([
  "payment",
  "settle all balances",
  "pago",
  "zahlung",
]);

function parseDecimalCell(value: string): Decimal | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "-") return null;
  // Accept "1,234.56" and "1.234,56"; reject anything else.
  let normalized = trimmed.replace(/\s/g, "");
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  if (lastComma > lastDot) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = normalized.replace(/,/g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  try {
    return new Decimal(normalized);
  } catch {
    return null;
  }
}

/** Converts a major-unit decimal into integer minor units for a currency. */
function toMinorUnits(value: Decimal, currency: string): string {
  const exponent = currencyExponent(currency);
  return value
    .times(new Decimal(10).pow(exponent))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
    .toFixed(0);
}

/**
 * Picks the field delimiter from the header line.
 *
 * Splitwise exports from locales that use a decimal comma are semicolon
 * separated. Guessing from the header rather than the whole file avoids being
 * confused by commas inside quoted descriptions.
 */
function detectDelimiter(content: string): string {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  if (semicolons > commas && semicolons >= tabs) return ";";
  if (tabs > commas && tabs > semicolons) return "\t";
  return ",";
}

function normalizeDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // Splitwise also emits DD/MM/YYYY and MM/DD/YYYY depending on locale. Without
  // a locale hint an ambiguous date cannot be resolved safely, so only accept
  // the unambiguous case where the first component cannot be a month.
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, first, second, year] = slash;
    const firstNumber = Number(first);
    const secondNumber = Number(second);
    if (firstNumber > 12 && secondNumber <= 12) {
      return `${year}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`;
    }
    if (secondNumber > 12 && firstNumber <= 12) {
      return `${year}-${first.padStart(2, "0")}-${second.padStart(2, "0")}`;
    }
    // Genuinely ambiguous: Splitwise's own export is ISO, so treat this as
    // MM/DD/YYYY (its US default) and let the preview show the result.
    return `${year}-${first.padStart(2, "0")}-${second.padStart(2, "0")}`;
  }
  return null;
}

export const splitwiseCsvAdapter: ImportAdapter = {
  format: "splitwise_csv",

  detect(content: string, fileName: string): boolean {
    if (!fileName.toLowerCase().endsWith(".csv")) return false;
    const firstLine = content.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
    return (
      DATE_HEADERS.some((header) => firstLine.includes(header)) &&
      COST_HEADERS.some((header) => firstLine.includes(header))
    );
  },

  parse(content: string): ParsedImport {
    let records: string[][];
    try {
      records = parse(content, {
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
        delimiter: detectDelimiter(content),
      }) as string[][];
    } catch (error) {
      throw new ImportParseError(
        "That file could not be read as CSV.",
        error instanceof Error ? error.message : undefined,
      );
    }

    if (records.length === 0) {
      throw new ImportParseError("The file is empty.");
    }

    const headers = records[0].map((header) => header.trim());
    const dateIndex = findHeader(headers, DATE_HEADERS);
    const descriptionIndex = findHeader(headers, DESCRIPTION_HEADERS);
    const costIndex = findHeader(headers, COST_HEADERS);
    const currencyIndex = findHeader(headers, CURRENCY_HEADERS);
    const categoryIndex = findHeader(headers, CATEGORY_HEADERS);

    const missing: string[] = [];
    if (dateIndex === -1) missing.push("Date");
    if (descriptionIndex === -1) missing.push("Description");
    if (costIndex === -1) missing.push("Cost");
    if (missing.length > 0) {
      throw new ImportParseError(
        `This does not look like a Splitwise export: missing the ${missing.join(", ")} column(s).`,
        `Found columns: ${headers.join(", ")}`,
      );
    }

    // Whatever is not a known column, and not blank, is a person.
    const structuralIndexes = new Set(
      [
        dateIndex,
        descriptionIndex,
        costIndex,
        currencyIndex,
        categoryIndex,
      ].filter((index) => index !== -1),
    );
    const personColumns: { index: number; name: string }[] = [];
    headers.forEach((header, index) => {
      if (structuralIndexes.has(index)) return;
      const name = header.trim();
      if (name === "" || IGNORED_HEADERS.includes(name.toLowerCase())) return;
      personColumns.push({ index, name });
    });

    if (personColumns.length === 0) {
      throw new ImportParseError(
        "No participant columns were found in the export.",
        `Found columns: ${headers.join(", ")}`,
      );
    }

    const warnings: ImportWarning[] = [];
    const rows: { rowNumber: number; row: StagedRow }[] = [];
    const currencies = new Set<string>();

    for (let index = 1; index < records.length; index += 1) {
      const record = records[index];
      // Header row is 1; data starts at 2, matching what a spreadsheet shows.
      const rowNumber = index + 1;
      const description = (record[descriptionIndex] ?? "").trim();

      // The export ends with a "Total balance" summary; it is not a transaction.
      if (
        description.toLowerCase().startsWith("total balance") ||
        (record[dateIndex] ?? "").trim() === ""
      ) {
        continue;
      }

      const date = normalizeDate(record[dateIndex] ?? "");
      if (!date) {
        warnings.push({
          rowNumber,
          message: `Skipped a row with an unrecognised date`,
          detail: (record[dateIndex] ?? "").slice(0, 60),
        });
        continue;
      }

      const currency = (
        currencyIndex === -1 ? "" : (record[currencyIndex] ?? "")
      )
        .trim()
        .toUpperCase();
      if (currency === "" || !isSupportedCurrency(currency)) {
        warnings.push({
          rowNumber,
          message: `Skipped a row with an unsupported currency`,
          detail: currency || "(blank)",
        });
        continue;
      }
      currencies.add(currency);

      const cost = parseDecimalCell(record[costIndex] ?? "");
      if (!cost) {
        warnings.push({
          rowNumber,
          message: "Skipped a row with an unreadable amount",
          detail: (record[costIndex] ?? "").slice(0, 60),
        });
        continue;
      }

      // Each person column holds their signed net for the row.
      const nets = new Map<string, Decimal>();
      let unreadable = false;
      for (const column of personColumns) {
        const cell = record[column.index] ?? "";
        const value =
          cell.trim() === "" ? new Decimal(0) : parseDecimalCell(cell);
        if (value === null) {
          unreadable = true;
          break;
        }
        nets.set(column.name, value);
      }
      if (unreadable) {
        warnings.push({
          rowNumber,
          message: "Skipped a row with an unreadable participant amount",
        });
        continue;
      }

      const isSettlement =
        SETTLEMENT_DESCRIPTIONS.has(description.toLowerCase()) || cost.isZero();

      if (isSettlement) {
        // A repayment shows one positive and one negative net of equal size.
        const payer = [...nets.entries()].find(([, value]) =>
          value.isNegative(),
        );
        const receiver = [...nets.entries()].find(([, value]) =>
          value.greaterThan(0),
        );
        if (!payer || !receiver) {
          warnings.push({
            rowNumber,
            message: "Skipped a payment row that names no payer or recipient",
          });
          continue;
        }
        rows.push({
          rowNumber,
          row: {
            kind: "settlement",
            date,
            amount: toMinorUnits(receiver[1], currency),
            currency,
            fromSourceName: payer[0],
            toSourceName: receiver[0],
            notes: description || null,
          },
        });
        continue;
      }

      // For an expense: owed share = paid − net, and paid is only non-zero for
      // the people who actually put money in. Splitwise gives us the net, so
      // reconstruct shares as (equal-cost split implied by the net) — concretely,
      // share = paid − net where the positives are the payers' surplus.
      const payers: StagedShare[] = [];
      const shares: StagedShare[] = [];

      // Everyone's share is their cost contribution: cost is distributed such
      // that share_i = paid_i − net_i. We know net_i; we recover paid_i by
      // assigning the total cost to those with positive net proportionally to
      // their surplus, which is exactly how Splitwise's export encodes it.
      const positiveSum = [...nets.values()]
        .filter((value) => value.greaterThan(0))
        .reduce((sum, value) => sum.plus(value), new Decimal(0));

      if (positiveSum.isZero()) {
        warnings.push({
          rowNumber,
          message: "Skipped an expense row where nobody appears to have paid",
        });
        continue;
      }

      for (const [name, net] of nets) {
        const paid = net.greaterThan(0)
          ? cost.times(net).dividedBy(positiveSum)
          : new Decimal(0);
        const share = paid.minus(net);
        if (paid.greaterThan(0)) {
          payers.push({
            sourceName: name,
            amount: toMinorUnits(paid, currency),
          });
        }
        if (!share.isZero()) {
          shares.push({
            sourceName: name,
            amount: toMinorUnits(share, currency),
          });
        }
      }

      // Rounding can leave the parts a minor unit off the total; nudge the
      // largest share so the expense is internally consistent.
      const totalMinor = BigInt(toMinorUnits(cost, currency));
      const balanced = balanceToTotal(shares, totalMinor);
      const balancedPayers = balanceToTotal(payers, totalMinor);

      rows.push({
        rowNumber,
        row: {
          kind: "expense",
          description: description || "Imported expense",
          category:
            categoryIndex === -1
              ? null
              : (record[categoryIndex] ?? "").trim() || null,
          date,
          amount: totalMinor.toString(),
          currency,
          payers: balancedPayers,
          shares: balanced,
        },
      });
    }

    const participants: StagedParticipant[] = personColumns.map((column) => ({
      sourceName: column.name,
    }));

    return {
      format: "splitwise_csv",
      rows,
      participants,
      currencies: [...currencies].sort(),
      warnings,
      detected: {
        headers,
        personColumns: personColumns.map((column) => column.name),
        rowCount: rows.length,
      },
    };
  },
};

/** Adjusts the largest entry so the parts sum exactly to `total`. */
function balanceToTotal(
  entries: readonly StagedShare[],
  total: bigint,
): StagedShare[] {
  if (entries.length === 0) return [];
  const values = entries.map((entry) => BigInt(entry.amount));
  const sum = values.reduce((accumulator, value) => accumulator + value, 0n);
  const difference = total - sum;
  if (difference === 0n) {
    return entries.map((entry, index) => ({
      sourceName: entry.sourceName,
      amount: values[index].toString(),
    }));
  }

  let targetIndex = 0;
  let largest = -1n;
  values.forEach((value, index) => {
    const magnitude = value < 0n ? -value : value;
    if (magnitude > largest) {
      largest = magnitude;
      targetIndex = index;
    }
  });
  values[targetIndex] += difference;

  return entries.map((entry, index) => ({
    sourceName: entry.sourceName,
    amount: values[index].toString(),
  }));
}
