import { isSupportedCurrency } from "@/modules/currencies/iso-4217";
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
 * Balancia's own JSON export, read back in.
 *
 * The export card calls JSON "the one to keep rather than the one to open",
 * and a file you keep is only a backup if something can restore it. This
 * adapter is that something: the file group settings hands you goes back
 * through the same staging model, preview and participant mapping every other
 * import uses.
 *
 * What that buys, and what it does not:
 *
 *  - **Amounts are already minor units**, written by the exporter as integer
 *    strings. Nothing is multiplied, rounded or re-parsed here — the one thing
 *    a backup must never do is lose a digit, and the safest way not to is to
 *    do no arithmetic at all.
 *  - **Categories come back as they left.** Balancia's codes are checked
 *    exactly, before the Splitwise label tables get a look at them.
 *  - **People are matched by ID inside the file**, not by the name printed
 *    next to each share, so a rename between export and restore cannot split
 *    one person into two.
 *
 * What a restore cannot carry is stated in warnings rather than left to be
 * discovered: recurring templates, receipts, and the converted amounts of a
 * `converted` group. The export holds the first two only as counts, and the
 * staging model has nowhere to put a historical rate — the commit step writes
 * imported rows in their own currency on purpose.
 */

/** The only `exportVersion` this adapter knows how to read. */
const SUPPORTED_EXPORT_VERSION = 1;

interface BackupEnvelope {
  exportVersion?: unknown;
  exportedAt?: unknown;
}

interface BackupShare {
  participantId?: unknown;
  displayName?: unknown;
  amount?: unknown;
}

interface BackupExpense {
  description?: unknown;
  notes?: unknown;
  category?: unknown;
  subcategory?: unknown;
  amount?: unknown;
  currency?: unknown;
  convertedAmount?: unknown;
  expenseDate?: unknown;
  attachmentCount?: unknown;
  payers?: unknown;
  shares?: unknown;
}

interface BackupSettlement {
  fromParticipantId?: unknown;
  fromName?: unknown;
  toParticipantId?: unknown;
  toName?: unknown;
  amount?: unknown;
  currency?: unknown;
  convertedAmount?: unknown;
  settledOn?: unknown;
  notes?: unknown;
}

interface BackupParticipant {
  id?: unknown;
  displayName?: unknown;
  email?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Minor units, exactly as the exporter wrote them. No arithmetic. */
function asMinorUnits(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^-?\d+$/.test(trimmed) ? trimmed : null;
}

function asDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function envelope(payload: unknown): BackupEnvelope | null {
  const record = asRecord(payload);
  if (!record) return null;
  return asRecord(record.balancia);
}

export const balanciaJsonAdapter: ImportAdapter = {
  format: "balancia_json",

  detect(content: string, fileName: string): boolean {
    if (!fileName.toLowerCase().endsWith(".json")) return false;
    try {
      const marker = envelope(JSON.parse(content));
      // The envelope is the whole test. A version we cannot read is still ours
      // to refuse — falling through to another adapter would report a Balancia
      // backup as an unrecognised Splitwise file.
      return typeof marker?.exportVersion === "number";
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

    const marker = envelope(payload);
    if (typeof marker?.exportVersion !== "number") {
      throw new ImportParseError(
        "This JSON file is not a Balancia export.",
        'A Balancia export starts with a "balancia" block naming its version.',
      );
    }
    if (marker.exportVersion > SUPPORTED_EXPORT_VERSION) {
      throw new ImportParseError(
        "This backup was written by a newer version of Balancia.",
        `The file says export version ${marker.exportVersion}; this instance reads version ${SUPPORTED_EXPORT_VERSION}. Update Balancia, then import it again.`,
      );
    }

    const root = asRecord(payload) ?? {};
    const warnings: ImportWarning[] = [];
    const rows: { rowNumber: number; row: StagedRow }[] = [];
    const currencies = new Set<string>();

    // ---- People -------------------------------------------------------
    //
    // Display names are the staging model's key, and nothing stops a group
    // holding two people called "Alex". Merging them would silently move money
    // between two humans, so a repeat is numbered and said out loud; the
    // preview then lets the user point each one at the right person.
    const participants = new Map<string, StagedParticipant>();
    const nameById = new Map<string, string>();
    const usedNames = new Set<string>();
    let renamedForClash = 0;

    for (const entry of asArray(root.participants)) {
      const record = asRecord(entry) as BackupParticipant | null;
      if (!record) continue;
      const id = asText(record.id);
      const declared = asText(record.displayName);
      if (!declared) continue;

      let name = declared;
      for (let suffix = 2; usedNames.has(name.toLowerCase()); suffix += 1) {
        name = `${declared} (${suffix})`;
      }
      if (name !== declared) renamedForClash += 1;
      usedNames.add(name.toLowerCase());
      if (id) nameById.set(id, name);
      participants.set(name, {
        sourceName: name,
        email: asText(record.email),
      });
    }

    if (renamedForClash > 0) {
      warnings.push({
        rowNumber: null,
        message:
          "The backup holds people who share a display name; the repeats are numbered so they stay separate",
        detail: `${renamedForClash} numbered`,
      });
    }

    /**
     * The ID inside the file wins over the name printed beside the share: a
     * participant renamed between two exports is still the same person.
     */
    const resolve = (share: BackupShare): string | null => {
      const id = asText(share.participantId);
      if (id) {
        const known = nameById.get(id);
        if (known) return known;
      }
      // A name on a share but not in the roster still has to reach the preview,
      // or the row commits against a person nobody was asked about.
      const fallback = asText(share.displayName);
      if (fallback && !participants.has(fallback)) {
        participants.set(fallback, { sourceName: fallback, email: null });
        usedNames.add(fallback.toLowerCase());
        if (id) nameById.set(id, fallback);
      }
      return fallback;
    };

    const readShares = (
      value: unknown,
    ): { shares: StagedShare[]; total: bigint } | null => {
      const shares: StagedShare[] = [];
      let total = 0n;
      for (const entry of asArray(value)) {
        const record = asRecord(entry) as BackupShare | null;
        if (!record) return null;
        const sourceName = resolve(record);
        const amount = asMinorUnits(record.amount);
        if (!sourceName || amount === null) return null;
        total += BigInt(amount);
        // A zero share says "took no part", which is what leaving the person
        // off the row already says.
        if (BigInt(amount) !== 0n) shares.push({ sourceName, amount });
      }
      return { shares, total };
    };

    // ---- Expenses -----------------------------------------------------
    let rowNumber = 0;
    let convertedDropped = 0;
    let attachmentsDropped = 0;

    for (const entry of asArray(root.expenses)) {
      rowNumber += 1;
      const expense = asRecord(entry) as BackupExpense | null;
      if (!expense) {
        warnings.push({
          rowNumber,
          message: "Skipped an expense that is not an object",
        });
        continue;
      }

      const date = asDate(expense.expenseDate);
      if (!date) {
        warnings.push({
          rowNumber,
          message: "Skipped an expense with a missing or unreadable date",
        });
        continue;
      }

      const currency = (asText(expense.currency) ?? "").toUpperCase();
      if (!isSupportedCurrency(currency)) {
        warnings.push({
          rowNumber,
          message: "Skipped an expense with an unsupported currency",
          detail: currency || "(blank)",
        });
        continue;
      }

      const amount = asMinorUnits(expense.amount);
      if (amount === null || BigInt(amount) <= 0n) {
        warnings.push({
          rowNumber,
          message: "Skipped an expense with an unreadable total",
          detail: String(expense.amount ?? "").slice(0, 60),
        });
        continue;
      }

      const payers = readShares(expense.payers);
      const shares = readShares(expense.shares);
      if (!payers || !shares) {
        warnings.push({
          rowNumber,
          message: "Skipped an expense with unreadable payers or shares",
        });
        continue;
      }
      if (payers.shares.length === 0 || shares.shares.length === 0) {
        warnings.push({
          rowNumber,
          message: "Skipped an expense that names nobody",
        });
        continue;
      }
      if (payers.total !== BigInt(amount) || shares.total !== BigInt(amount)) {
        warnings.push({
          rowNumber,
          message:
            "Skipped an expense whose payers and shares do not add up to the total",
          detail: `total=${amount} paid=${payers.total} owed=${shares.total}`,
        });
        continue;
      }

      currencies.add(currency);
      if (asMinorUnits(expense.convertedAmount) !== null) convertedDropped += 1;
      if (typeof expense.attachmentCount === "number") {
        attachmentsDropped += expense.attachmentCount;
      }

      rows.push({
        rowNumber,
        row: {
          kind: "expense",
          description: asText(expense.description) ?? "Imported expense",
          category: asText(expense.category),
          subcategory: asText(expense.subcategory),
          notes: asText(expense.notes),
          date,
          amount,
          currency,
          payers: payers.shares,
          shares: shares.shares,
        },
      });
    }

    // ---- Settlements --------------------------------------------------
    for (const entry of asArray(root.settlements)) {
      rowNumber += 1;
      const settlement = asRecord(entry) as BackupSettlement | null;
      if (!settlement) {
        warnings.push({
          rowNumber,
          message: "Skipped a payment that is not an object",
        });
        continue;
      }

      const date = asDate(settlement.settledOn);
      if (!date) {
        warnings.push({
          rowNumber,
          message: "Skipped a payment with a missing or unreadable date",
        });
        continue;
      }

      const currency = (asText(settlement.currency) ?? "").toUpperCase();
      if (!isSupportedCurrency(currency)) {
        warnings.push({
          rowNumber,
          message: "Skipped a payment with an unsupported currency",
          detail: currency || "(blank)",
        });
        continue;
      }

      const amount = asMinorUnits(settlement.amount);
      if (amount === null || BigInt(amount) <= 0n) {
        warnings.push({
          rowNumber,
          message: "Skipped a payment with an unreadable amount",
          detail: String(settlement.amount ?? "").slice(0, 60),
        });
        continue;
      }

      const from = resolve({
        participantId: settlement.fromParticipantId,
        displayName: settlement.fromName,
      });
      const to = resolve({
        participantId: settlement.toParticipantId,
        displayName: settlement.toName,
      });
      if (!from || !to) {
        warnings.push({
          rowNumber,
          message: "Skipped a payment that does not name both people",
        });
        continue;
      }
      if (from === to) {
        warnings.push({
          rowNumber,
          message: "Skipped a payment from someone to themselves",
        });
        continue;
      }

      currencies.add(currency);
      if (asMinorUnits(settlement.convertedAmount) !== null) {
        convertedDropped += 1;
      }

      rows.push({
        rowNumber,
        row: {
          kind: "settlement",
          date,
          amount,
          currency,
          fromSourceName: from,
          toSourceName: to,
          notes: asText(settlement.notes),
        },
      });
    }

    // ---- What a restore leaves behind ---------------------------------
    const recurringCount = asArray(root.recurringExpenses).length;
    if (recurringCount > 0) {
      warnings.push({
        rowNumber: null,
        message:
          "Recurring expenses are not restored — set them up again on the recurring screen",
        detail: `${recurringCount} in the backup`,
      });
    }
    if (attachmentsDropped > 0) {
      warnings.push({
        rowNumber: null,
        message:
          "Receipts are not in an export, so the restored expenses have none",
        detail: `${attachmentsDropped} in the original group`,
      });
    }
    if (convertedDropped > 0) {
      warnings.push({
        rowNumber: null,
        message:
          "Converted amounts are not restored; each row comes back in the currency it was entered in",
        detail: `${convertedDropped} affected`,
      });
    }

    if (rows.length === 0 && participants.size === 0) {
      throw new ImportParseError(
        "That backup holds nothing to import.",
        "No expenses, payments or people were found in the file.",
      );
    }

    return {
      format: "balancia_json",
      rows,
      participants: [...participants.values()],
      currencies: [...currencies].sort(),
      warnings,
      detected: {
        exportVersion: marker.exportVersion,
        exportedAt: asText(marker.exportedAt),
        sourceGroup: asText(asRecord(root.group)?.name),
        importable: rows.length,
        recurringSkipped: recurringCount,
      },
    };
  },
};
