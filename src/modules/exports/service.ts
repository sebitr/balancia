import "server-only";
import type { Database } from "@/lib/db/client";
import {
  requirePermission,
  type GroupAccess,
} from "@/lib/security/authorization";
import { listParticipants } from "@/modules/groups/service";
import { listExpenses } from "@/modules/expenses/service";
import { listSettlements } from "@/modules/settlements/service";
import { listRecurringExpenses } from "@/modules/recurring/service";
import type {
  RecurrenceFrequency,
  WeekOfMonth,
} from "@/modules/recurring/schedule";
import { loadGroupBalances } from "@/modules/balances/service";
import { money, toMajorString } from "@/modules/currencies/money";
import { isSpending, type EntryDirection } from "@/modules/expenses/direction";
import { toCsv } from "./csv";
import { buildXlsx, xlsxNumber, type XlsxCell, type XlsxSheet } from "./xlsx";

/**
 * Group export.
 *
 * Balancia's claim is that you can leave. That is only true if leaving
 * produces something usable, so the same data is offered three ways:
 *
 *  - **JSON** is canonical and lossless. Amounts are integer minor units as
 *    strings, exactly as they are stored and exactly as every other JSON
 *    boundary in this codebase carries them. It is also the one format that
 *    reads back in: `src/modules/imports/balancia-json.ts` restores it, so a
 *    change to the shape below is a change to what a backup can be restored
 *    from — bump `exportVersion` rather than quietly moving a field. Adding
 *    one is not that: an older instance ignores a field it does not know,
 *    where a version it does not know makes it refuse the whole file.
 *  - **CSV** is for a spreadsheet or a script. One row per share, so "what did
 *    this person owe on this expense" is a filter rather than a calculation.
 *  - **XLSX** is the same data as a workbook, for people who do not want to
 *    think about delimiters and encodings at all.
 *
 * The CSV and XLSX forms present amounts in major units because that is what a
 * spreadsheet can sum. JSON remains the format to re-import or archive: it is
 * the one that cannot lose a digit.
 */

/** Pages through the expense list rather than issuing one unbounded query. */
const PAGE_SIZE = 500;

async function listAllExpenses(groupId: string, db?: Database) {
  const all: Awaited<ReturnType<typeof listExpenses>> = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await listExpenses(groupId, {
      db,
      limit: PAGE_SIZE,
      offset,
    });
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}

export interface GroupExport {
  readonly balancia: { readonly exportVersion: 1; readonly exportedAt: string };
  readonly group: {
    readonly id: string;
    readonly name: string;
    readonly currencyMode: "separate" | "converted";
    readonly baseCurrency: string | null;
    readonly timezone: string;
    readonly archivedAt: string | null;
  };
  readonly participants: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly email: string | null;
    readonly role: "owner" | "member" | "guest";
    readonly hasAccount: boolean;
  }[];
  readonly expenses: readonly {
    readonly id: string;
    /**
     * `out` — spending. `in` — income. Without it a restored backup files
     * every income as spending, and the balance it contributes flips sign.
     */
    readonly direction: EntryDirection;
    readonly description: string;
    readonly notes: string | null;
    readonly category: string | null;
    readonly subcategory: string | null;
    /** Integer minor units, as a string. */
    readonly amount: string;
    readonly currency: string;
    readonly convertedAmount: string | null;
    readonly convertedCurrency: string | null;
    readonly exchangeRate: string | null;
    readonly splitMethod: "equal" | "exact" | "percentage" | "shares";
    readonly expenseDate: string;
    readonly createdAt: string;
    readonly recurringExpenseId: string | null;
    readonly attachmentCount: number;
    readonly payers: readonly {
      readonly participantId: string;
      readonly displayName: string;
      readonly amount: string;
    }[];
    readonly shares: readonly {
      readonly participantId: string;
      readonly displayName: string;
      readonly amount: string;
    }[];
  }[];
  readonly settlements: readonly {
    readonly id: string;
    readonly fromParticipantId: string;
    readonly fromName: string;
    readonly toParticipantId: string;
    readonly toName: string;
    readonly amount: string;
    readonly currency: string;
    readonly convertedAmount: string | null;
    readonly convertedCurrency: string | null;
    readonly exchangeRate: string | null;
    readonly settledOn: string;
    readonly notes: string | null;
    readonly createdAt: string;
  }[];
  readonly recurringExpenses: readonly {
    readonly id: string;
    readonly direction: EntryDirection;
    readonly description: string;
    readonly category: string | null;
    readonly subcategory: string | null;
    readonly amount: string;
    readonly currency: string;
    readonly frequency: RecurrenceFrequency;
    readonly interval: number;
    readonly weekday: number | null;
    readonly weekOfMonth: WeekOfMonth | null;
    readonly dayOfMonth: number | null;
    readonly monthOfYear: number | null;
    readonly startDate: string;
    readonly endDate: string | null;
    readonly occurrenceCount: number | null;
    readonly paused: boolean;
    readonly timezone: string;
    readonly generatedCount: number;
  }[];
  readonly balances: readonly {
    readonly currency: string;
    readonly entries: readonly {
      readonly participantId: string;
      readonly displayName: string;
      /** Positive: owed to them. Negative: owed by them. Minor units. */
      readonly amount: string;
    }[];
  }[];
}

/**
 * Assembles everything a group contains.
 *
 * Reuses the same services the screens use, so an export can never disagree
 * with what the application displayed — in particular the balances come from
 * the one balance engine, not from a second implementation written for export.
 */
export async function buildGroupExport(
  access: GroupAccess,
  options: { db?: Database; now?: Date } = {},
): Promise<GroupExport> {
  requirePermission(access, "exportData");
  const { db } = options;

  const [participants, expenses, settlements, recurring, balances] =
    await Promise.all([
      listParticipants(access.groupId, { db, includeRemoved: true }),
      listAllExpenses(access.groupId, db),
      listSettlements(access.groupId, { db, limit: Number.MAX_SAFE_INTEGER }),
      listRecurringExpenses(access.groupId, { db }),
      loadGroupBalances(access, { db }),
    ]);

  return {
    balancia: {
      exportVersion: 1,
      exportedAt: (options.now ?? new Date()).toISOString(),
    },
    group: {
      id: access.groupId,
      name: access.group.name,
      currencyMode: access.group.currencyMode,
      baseCurrency: access.group.baseCurrency,
      timezone: access.group.timezone,
      archivedAt: access.group.archivedAt?.toISOString() ?? null,
    },
    participants: participants.map((participant) => ({
      id: participant.id,
      displayName: participant.displayName,
      email: participant.email,
      role: participant.role,
      hasAccount: participant.userId !== null,
    })),
    expenses: expenses.map((expense) => ({
      id: expense.id,
      direction: expense.direction,
      description: expense.description,
      notes: expense.notes,
      category: expense.category,
      subcategory: expense.subcategory,
      amount: expense.amount.toString(),
      currency: expense.currency,
      convertedAmount: expense.convertedAmount?.toString() ?? null,
      convertedCurrency: expense.convertedCurrency,
      exchangeRate: expense.exchangeRate,
      splitMethod: expense.splitMethod,
      expenseDate: expense.expenseDate,
      createdAt: expense.createdAt.toISOString(),
      recurringExpenseId: expense.recurringExpenseId,
      attachmentCount: expense.attachmentCount,
      payers: expense.payers.map((payer) => ({
        participantId: payer.participantId,
        displayName: payer.displayName,
        amount: payer.amount.toString(),
      })),
      shares: expense.shares.map((share) => ({
        participantId: share.participantId,
        displayName: share.displayName,
        amount: share.amount.toString(),
      })),
    })),
    settlements: settlements.map((settlement) => ({
      id: settlement.id,
      fromParticipantId: settlement.fromParticipantId,
      fromName: settlement.fromName,
      toParticipantId: settlement.toParticipantId,
      toName: settlement.toName,
      amount: settlement.amount.toString(),
      currency: settlement.currency,
      convertedAmount: settlement.convertedAmount?.toString() ?? null,
      convertedCurrency: settlement.convertedCurrency,
      exchangeRate: settlement.exchangeRate,
      settledOn: settlement.settledOn,
      notes: settlement.notes,
      createdAt: settlement.createdAt.toISOString(),
    })),
    recurringExpenses: recurring.map((template) => ({
      id: template.id,
      direction: template.direction,
      description: template.description,
      category: template.category,
      subcategory: template.subcategory,
      amount: template.amount.toString(),
      currency: template.currency,
      frequency: template.frequency,
      interval: template.interval,
      weekday: template.weekday,
      weekOfMonth: template.weekOfMonth,
      dayOfMonth: template.dayOfMonth,
      monthOfYear: template.monthOfYear,
      startDate: template.startDate,
      endDate: template.endDate,
      occurrenceCount: template.occurrenceCount,
      paused: template.pausedAt !== null,
      timezone: template.timezone,
      generatedCount: template.generatedCount,
    })),
    balances: balances.currencies.map((entry) => ({
      currency: entry.currency,
      entries: entry.balances.map((balance) => ({
        participantId: balance.participantId,
        displayName:
          balances.participantNames.get(balance.participantId) ?? "Unknown",
        amount: balance.amount.toString(),
      })),
    })),
  };
}

/** Major-unit decimal string for a minor-unit figure, e.g. "1050" → "10.50". */
function major(minorUnits: string, currency: string): string {
  return toMajorString(money(BigInt(minorUnits), currency));
}

const EXPENSE_HEADERS = [
  "Date",
  "Description",
  "Category",
  "Subcategory",
  "Direction",
  "Currency",
  "Total",
  "Person",
  "Owed share",
  "Paid",
  "Converted currency",
  "Converted total",
  "Exchange rate",
  "Split method",
  "Recurring",
  "Receipts",
  "Notes",
  "Expense ID",
] as const;

/**
 * One row per person per expense: their share, and what they paid towards it.
 * This shape answers "who owes what on this line" by filtering rather than by
 * unpacking a comma-separated cell.
 */
function expenseRows(data: GroupExport): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];

  for (const expense of data.expenses) {
    const paidBy = new Map(
      expense.payers.map((payer) => [payer.participantId, payer.amount]),
    );
    // Someone who paid but owes nothing still belongs in the file.
    const people = [
      ...new Set([
        ...expense.shares.map((share) => share.participantId),
        ...expense.payers.map((payer) => payer.participantId),
      ]),
    ];

    for (const participantId of people) {
      const share = expense.shares.find(
        (entry) => entry.participantId === participantId,
      );
      const payer = expense.payers.find(
        (entry) => entry.participantId === participantId,
      );
      const paid = paidBy.get(participantId);

      rows.push([
        expense.expenseDate,
        expense.description,
        expense.category,
        expense.subcategory,
        // Spelt out rather than left as the stored code: a spreadsheet's
        // "Total" column sums income and spending together, and this is the
        // column that says which of the two a row was.
        isSpending(expense.direction) ? "spending" : "income",
        expense.currency,
        major(expense.amount, expense.currency),
        share?.displayName ?? payer?.displayName ?? "Unknown",
        share ? major(share.amount, expense.currency) : "0",
        paid ? major(paid, expense.currency) : "0",
        expense.convertedCurrency,
        expense.convertedAmount && expense.convertedCurrency
          ? major(expense.convertedAmount, expense.convertedCurrency)
          : null,
        expense.exchangeRate,
        expense.splitMethod,
        expense.recurringExpenseId ? "yes" : "no",
        expense.attachmentCount,
        expense.notes,
        expense.id,
      ]);
    }
  }

  return rows;
}

const PAYMENT_HEADERS = [
  "Date",
  "From",
  "To",
  "Currency",
  "Amount",
  "Converted currency",
  "Converted amount",
  "Exchange rate",
  "Notes",
  "Payment ID",
] as const;

function paymentRows(data: GroupExport): (string | number | null)[][] {
  return data.settlements.map((settlement) => [
    settlement.settledOn,
    settlement.fromName,
    settlement.toName,
    settlement.currency,
    major(settlement.amount, settlement.currency),
    settlement.convertedCurrency,
    settlement.convertedAmount && settlement.convertedCurrency
      ? major(settlement.convertedAmount, settlement.convertedCurrency)
      : null,
    settlement.exchangeRate,
    settlement.notes,
    settlement.id,
  ]);
}

const PEOPLE_HEADERS = [
  "Name",
  "Email",
  "Role",
  "Has an account",
  "Participant ID",
] as const;

function peopleRows(data: GroupExport): (string | number | null)[][] {
  return data.participants.map((participant) => [
    participant.displayName,
    participant.email,
    participant.role,
    participant.hasAccount ? "yes" : "no",
    participant.id,
  ]);
}

const BALANCE_HEADERS = ["Currency", "Person", "Balance", "Position"] as const;

function balanceRows(data: GroupExport): (string | number | null)[][] {
  return data.balances.flatMap((entry) =>
    entry.entries.map((balance) => [
      entry.currency,
      balance.displayName,
      major(balance.amount, entry.currency),
      BigInt(balance.amount) > 0n
        ? "is owed"
        : BigInt(balance.amount) < 0n
          ? "owes"
          : "settled up",
    ]),
  );
}

/** The expenses CSV — the one most people want. */
export function toExpensesCsv(data: GroupExport): string {
  return toCsv([[...EXPENSE_HEADERS], ...expenseRows(data)]);
}

/** The whole group as one workbook. */
export function toWorkbook(data: GroupExport): Uint8Array {
  const sheets: XlsxSheet[] = [
    {
      name: "Expenses",
      rows: [
        [...EXPENSE_HEADERS],
        ...numericise(expenseRows(data), EXPENSE_HEADERS, [
          "Total",
          "Owed share",
          "Paid",
          "Converted total",
          "Receipts",
        ]),
      ],
    },
    {
      name: "Payments",
      rows: [
        [...PAYMENT_HEADERS],
        ...numericise(paymentRows(data), PAYMENT_HEADERS, [
          "Amount",
          "Converted amount",
        ]),
      ],
    },
    { name: "People", rows: [[...PEOPLE_HEADERS], ...peopleRows(data)] },
    {
      name: "Balances",
      rows: [
        [...BALANCE_HEADERS],
        ...numericise(balanceRows(data), BALANCE_HEADERS, ["Balance"]),
      ],
    },
  ];
  return buildXlsx(sheets);
}

/**
 * Marks the money columns as numeric so a spreadsheet can sum them, passing the
 * decimal literal straight through rather than via a JavaScript number.
 *
 * The columns are named, not numbered. They were numbered once, and the day a
 * `Subcategory` column was inserted ahead of them every number pointed one
 * column to its left: the workbook went out with the currency code written
 * into a numeric cell. A name cannot drift when a column is added, and one
 * that is not in the sheet throws here rather than shipping a broken cell.
 */
function numericise(
  rows: readonly (readonly (string | number | null)[])[],
  headers: readonly string[],
  numeric: readonly string[],
): XlsxCell[][] {
  const columns = numeric.map((name) => {
    const index = headers.indexOf(name);
    if (index === -1) {
      throw new Error(`No "${name}" column to make numeric`);
    }
    return index;
  });

  return rows.map((row) =>
    row.map((cell, index) => {
      if (!columns.includes(index) || cell === null || cell === "") return cell;
      return typeof cell === "number" ? cell : xlsxNumber(cell);
    }),
  );
}

/** A filesystem-safe basename for the downloaded file. */
export function exportFileName(groupName: string, extension: string): string {
  const slug =
    groupName
      .normalize("NFKD")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .toLowerCase() || "group";
  const today = new Date().toISOString().slice(0, 10);
  return `balancia-${slug}-${today}.${extension}`;
}
