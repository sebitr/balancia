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
 * Splitwise JSON backup adapter.
 *
 * Splitwise's API/backup JSON is richer than the CSV: each expense carries an
 * explicit `users` array with `paid_share` and `owed_share` per person, so
 * nothing has to be reconstructed from net positions. Multiple payers come
 * through naturally.
 *
 * The structure is only accepted when it is recognisably Splitwise — an
 * arbitrary JSON file is rejected with a clear message rather than being
 * half-imported.
 */

interface SplitwiseUser {
  id?: number;
  first_name?: string;
  last_name?: string | null;
  email?: string | null;
}

interface SplitwiseExpenseUser {
  user?: SplitwiseUser;
  user_id?: number;
  paid_share?: string;
  owed_share?: string;
}

interface SplitwiseExpense {
  id?: number;
  description?: string;
  details?: string | null;
  cost?: string;
  currency_code?: string;
  date?: string;
  deleted_at?: string | null;
  payment?: boolean;
  category?: { name?: string } | null;
  users?: SplitwiseExpenseUser[];
}

function displayName(user: SplitwiseUser | undefined): string | null {
  if (!user) return null;
  const first = (user.first_name ?? "").trim();
  const last = (user.last_name ?? "").trim();
  const full = [first, last].filter(Boolean).join(" ");
  return full || null;
}

function toMinorUnits(value: string, currency: string): string | null {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const exponent = currencyExponent(currency);
  return new Decimal(trimmed)
    .times(new Decimal(10).pow(exponent))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
    .toFixed(0);
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function extractExpenses(payload: unknown): SplitwiseExpense[] | null {
  if (Array.isArray(payload)) {
    return payload as SplitwiseExpense[];
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["expenses", "data", "items"]) {
      if (Array.isArray(record[key])) {
        return record[key] as SplitwiseExpense[];
      }
    }
  }
  return null;
}

export const splitwiseJsonAdapter: ImportAdapter = {
  format: "splitwise_json",

  detect(content: string, fileName: string): boolean {
    if (!fileName.toLowerCase().endsWith(".json")) return false;
    try {
      const parsed: unknown = JSON.parse(content);
      const expenses = extractExpenses(parsed);
      if (!expenses || expenses.length === 0) return false;
      // Recognised by the shape of an expense, not by the filename.
      return expenses.some(
        (expense) =>
          typeof expense === "object" &&
          expense !== null &&
          "cost" in expense &&
          Array.isArray((expense as SplitwiseExpense).users),
      );
    } catch {
      return false;
    }
  },

  parse(content: string): ParsedImport {
    let payload: unknown;
    try {
      payload = JSON.parse(content);
    } catch (error) {
      throw new ImportParseError(
        "That file is not valid JSON.",
        error instanceof Error ? error.message : undefined,
      );
    }

    const sourceExpenses = extractExpenses(payload);
    if (!sourceExpenses) {
      throw new ImportParseError(
        "This JSON file does not contain a Splitwise expense list.",
        'Expected an array of expenses, or an object with an "expenses" array.',
      );
    }

    const warnings: ImportWarning[] = [];
    const rows: { rowNumber: number; row: StagedRow }[] = [];
    const participants = new Map<string, StagedParticipant>();
    const currencies = new Set<string>();
    let deletedSkipped = 0;

    sourceExpenses.forEach((expense, index) => {
      const rowNumber = index + 1;

      if (expense.deleted_at) {
        deletedSkipped += 1;
        return;
      }

      const date = normalizeDate(expense.date);
      if (!date) {
        warnings.push({
          rowNumber,
          message: "Skipped an entry with a missing or unreadable date",
        });
        return;
      }

      const currency = (expense.currency_code ?? "").trim().toUpperCase();
      if (!currency || !isSupportedCurrency(currency)) {
        warnings.push({
          rowNumber,
          message: "Skipped an entry with an unsupported currency",
          detail: currency || "(blank)",
        });
        return;
      }
      currencies.add(currency);

      const total = toMinorUnits(expense.cost ?? "", currency);
      if (total === null) {
        warnings.push({
          rowNumber,
          message: "Skipped an entry with an unreadable cost",
          detail: (expense.cost ?? "").slice(0, 60),
        });
        return;
      }

      const users = expense.users ?? [];
      if (users.length === 0) {
        warnings.push({
          rowNumber,
          message: "Skipped an entry that lists no participants",
        });
        return;
      }

      const payers: StagedShare[] = [];
      const shares: StagedShare[] = [];
      let malformed = false;

      for (const entry of users) {
        const name =
          displayName(entry.user) ??
          (entry.user_id ? `Splitwise user ${entry.user_id}` : null);
        if (!name) {
          malformed = true;
          break;
        }
        if (!participants.has(name)) {
          participants.set(name, {
            sourceName: name,
            email: entry.user?.email ?? null,
          });
        }

        const paid = toMinorUnits(entry.paid_share ?? "0", currency);
        const owed = toMinorUnits(entry.owed_share ?? "0", currency);
        if (paid === null || owed === null) {
          malformed = true;
          break;
        }
        if (BigInt(paid) !== 0n) {
          payers.push({ sourceName: name, amount: paid });
        }
        if (BigInt(owed) !== 0n) {
          shares.push({ sourceName: name, amount: owed });
        }
      }

      if (malformed) {
        warnings.push({
          rowNumber,
          message: "Skipped an entry with unreadable participant amounts",
        });
        return;
      }

      const paidSum = payers.reduce(
        (accumulator, payer) => accumulator + BigInt(payer.amount),
        0n,
      );
      const owedSum = shares.reduce(
        (accumulator, share) => accumulator + BigInt(share.amount),
        0n,
      );

      if (paidSum !== BigInt(total) || owedSum !== BigInt(total)) {
        warnings.push({
          rowNumber,
          message:
            "Skipped an entry where the paid and owed shares do not add up to the total",
          detail: `cost=${total} paid=${paidSum} owed=${owedSum}`,
        });
        return;
      }

      // Splitwise flags repayments; they become settlements, not expenses.
      if (expense.payment) {
        if (payers.length !== 1 || shares.length !== 1) {
          warnings.push({
            rowNumber,
            message: "Skipped a payment that does not have exactly two parties",
          });
          return;
        }
        rows.push({
          rowNumber,
          row: {
            kind: "settlement",
            date,
            amount: total,
            currency,
            // In a Splitwise payment the person with `paid_share` hands the
            // money over, and the person carrying the `owed_share` is the one
            // whose balance it clears.
            fromSourceName: payers[0].sourceName,
            toSourceName: shares[0].sourceName,
            notes: expense.description ?? null,
          },
        });
        return;
      }

      rows.push({
        rowNumber,
        row: {
          kind: "expense",
          description: expense.description?.trim() || "Imported expense",
          category: expense.category?.name ?? null,
          notes: expense.details ?? null,
          date,
          amount: total,
          currency,
          payers,
          shares,
        },
      });
    });

    if (rows.length === 0 && warnings.length === 0 && deletedSkipped === 0) {
      throw new ImportParseError(
        "No importable entries were found in that file.",
      );
    }

    return {
      format: "splitwise_json",
      rows,
      participants: [...participants.values()],
      currencies: [...currencies].sort(),
      warnings,
      detected: {
        entryCount: sourceExpenses.length,
        importable: rows.length,
        deletedSkipped,
      },
    };
  },
};
