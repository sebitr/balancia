import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { computeBalances } from "@/modules/balances/engine";
import { balanciaJsonAdapter } from "@/modules/imports/balancia-json";
import type { StagedExpense } from "@/modules/imports/types";
import { toExpensesCsv, toWorkbook, type GroupExport } from "./service";

/**
 * A flat share with one entry each way: the rent going out, and the deposit
 * the landlord returned coming back in.
 *
 * Both are the same shape — a payer, two shares, a positive amount — and the
 * only thing separating them is `direction`. That is exactly why dropping the
 * field is silent: nothing else in the row looks wrong afterwards.
 */
const flatShare: GroupExport = {
  balancia: { exportVersion: 1, exportedAt: "2026-03-04T09:15:00.000Z" },
  group: {
    id: "group-1",
    name: "Flat 4B",
    currencyMode: "separate",
    baseCurrency: null,
    timezone: "Europe/Zurich",
    archivedAt: null,
  },
  participants: [
    {
      id: "p-ada",
      displayName: "Ada",
      email: "ada@example.test",
      role: "owner",
      hasAccount: true,
    },
    {
      id: "p-blaise",
      displayName: "Blaise",
      email: null,
      role: "member",
      hasAccount: false,
    },
  ],
  expenses: [
    {
      id: "e-rent",
      direction: "out",
      description: "Rent",
      notes: null,
      category: "home",
      subcategory: "rent",
      amount: "240000",
      currency: "CHF",
      convertedAmount: null,
      convertedCurrency: null,
      exchangeRate: null,
      splitMethod: "equal",
      expenseDate: "2026-02-01",
      createdAt: "2026-02-01T08:00:00.000Z",
      recurringExpenseId: null,
      attachmentCount: 0,
      payers: [
        { participantId: "p-ada", displayName: "Ada", amount: "240000" },
      ],
      shares: [
        { participantId: "p-ada", displayName: "Ada", amount: "120000" },
        { participantId: "p-blaise", displayName: "Blaise", amount: "120000" },
      ],
    },
    {
      id: "e-deposit",
      direction: "in",
      description: "Deposit returned",
      notes: null,
      category: "home",
      subcategory: null,
      amount: "80000",
      currency: "CHF",
      convertedAmount: null,
      convertedCurrency: null,
      exchangeRate: null,
      splitMethod: "equal",
      expenseDate: "2026-02-28",
      createdAt: "2026-02-28T08:00:00.000Z",
      recurringExpenseId: null,
      attachmentCount: 0,
      payers: [
        { participantId: "p-blaise", displayName: "Blaise", amount: "80000" },
      ],
      shares: [
        { participantId: "p-ada", displayName: "Ada", amount: "40000" },
        { participantId: "p-blaise", displayName: "Blaise", amount: "40000" },
      ],
    },
  ],
  settlements: [],
  recurringExpenses: [
    {
      id: "r-salary",
      direction: "in",
      description: "Lodger's share",
      // An income, so an income code: this used to say `home`, which was the
      // bug the second vocabulary exists to fix.
      category: "rent",
      subcategory: null,
      amount: "60000",
      currency: "CHF",
      frequency: "monthly",
      interval: 1,
      weekday: null,
      weekOfMonth: null,
      dayOfMonth: 1,
      monthOfYear: null,
      startDate: "2026-01-01",
      endDate: null,
      occurrenceCount: null,
      paused: false,
      timezone: "Europe/Zurich",
      generatedCount: 2,
    },
  ],
  balances: [
    {
      currency: "CHF",
      entries: [
        { participantId: "p-ada", displayName: "Ada", amount: "160000" },
        { participantId: "p-blaise", displayName: "Blaise", amount: "-160000" },
      ],
    },
  ],
};

/** The CSV as a grid. Nothing in the fixture needs quoting. */
function csvGrid(csv: string): string[][] {
  return csv
    .replace(/^﻿/, "")
    .split("\r\n")
    .map((line) => line.split(","));
}

/** One column of the expenses CSV, by header name, header row dropped. */
function column(csv: string, header: string): string[] {
  const [headers, ...rows] = csvGrid(csv);
  const index = headers.indexOf(header);
  expect(index).toBeGreaterThanOrEqual(0);
  return rows.map((row) => row[index]);
}

function sheet(bytes: Uint8Array, part: string): string {
  return strFromU8(unzipSync(bytes)[part]);
}

const stagedExpenses = (json: string): StagedExpense[] =>
  balanciaJsonAdapter
    .parse(json)
    .rows.map((entry) => entry.row)
    .filter((row): row is StagedExpense => row.kind === "expense");

describe("the spreadsheet exports", () => {
  it("says which way each entry moved money", () => {
    const csv = toExpensesCsv(flatShare);

    expect(csvGrid(csv)[0]).toContain("Direction");
    // Two rows per entry — one per person — in the order the entries are in.
    expect(column(csv, "Direction")).toEqual([
      "spending",
      "spending",
      "income",
      "income",
    ]);
    expect(column(csv, "Total")).toEqual([
      "2400.00",
      "2400.00",
      "800.00",
      "800.00",
    ]);
  });

  it("marks the money columns numeric, and only those", () => {
    // The columns were once listed by position, and a `Subcategory` column
    // inserted ahead of them moved every one a place to the left: the currency
    // code went out inside a numeric cell, which Excel reads as a broken file.
    const expenses = sheet(toWorkbook(flatShare), "xl/worksheets/sheet1.xml");

    expect(expenses).toContain("<v>2400.00</v>");
    expect(expenses).toContain("<v>1200.00</v>");
    expect(expenses).toContain('<is><t xml:space="preserve">CHF</t></is>');
    expect(expenses).not.toContain("<v>CHF</v>");
    expect(expenses).not.toContain("<v>Ada</v>");
    expect(expenses).not.toContain("<v>income</v>");
  });
});

describe("a backup round trip", () => {
  it("brings an income back as income", () => {
    const restored = stagedExpenses(JSON.stringify(flatShare));

    expect(restored.map((row) => [row.description, row.direction])).toEqual([
      ["Rent", "out"],
      ["Deposit returned", "in"],
    ]);
  });

  it("restores the balances the export was taken from", () => {
    const restored = stagedExpenses(JSON.stringify(flatShare));

    // People are staged by name, so the names stand in for IDs here.
    const balances = computeBalances({
      participantIds: ["Ada", "Blaise"],
      expenses: restored.map((row, index) => ({
        id: `restored-${index}`,
        currency: row.currency,
        direction: row.direction,
        payers: row.payers.map((payer) => ({
          participantId: payer.sourceName,
          amount: BigInt(payer.amount),
        })),
        shares: row.shares.map((share) => ({
          participantId: share.sourceName,
          amount: BigInt(share.amount),
        })),
      })),
      settlements: [],
    });

    // The same figures the export carries in its `balances` block: Blaise owes
    // Ada half the rent, less the half of the deposit that came back to them.
    expect(balances).toHaveLength(1);
    expect(balances[0].balances).toEqual([
      { participantId: "Ada", amount: 160000n, currency: "CHF" },
      { participantId: "Blaise", amount: -160000n, currency: "CHF" },
    ]);
  });

  it("restores an older backup, which has no directions, as spending", () => {
    const older = JSON.parse(JSON.stringify(flatShare)) as {
      expenses: { direction?: unknown }[];
    };
    for (const expense of older.expenses) delete expense.direction;

    const restored = stagedExpenses(JSON.stringify(older));
    expect(restored.map((row) => row.direction)).toEqual(["out", "out"]);
  });
});
