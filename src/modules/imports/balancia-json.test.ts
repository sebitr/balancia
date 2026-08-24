import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { balanciaJsonAdapter } from "./balancia-json";
import { splitwiseJsonAdapter } from "./splitwise-json";
import { ImportParseError } from "./types";
import type { StagedExpense, StagedSettlement } from "./types";

const fixture = (name: string): string =>
  readFileSync(
    path.join(process.cwd(), "tests/fixtures/balancia", name),
    "utf8",
  );

const backup = fixture("trip-group.json");

/**
 * The parts of the export these tests reach into. Deliberately narrower than
 * the real shape and deliberately mutable: a case here is a file that has been
 * changed, and naming only what it changes keeps the change readable.
 */
interface EditableBackup {
  balancia: { exportVersion: number };
  participants: { displayName: string }[];
  expenses: {
    direction?: string;
    amount: string;
    currency: string;
    payers: { displayName: string }[];
    shares: { displayName: string; amount: string }[];
  }[];
  settlements: unknown[];
  recurringExpenses: unknown[];
}

/** Rewrites one part of the fixture without restating the whole file. */
function edited(mutate: (data: EditableBackup) => void): string {
  const data = JSON.parse(backup) as EditableBackup;
  mutate(data);
  return JSON.stringify(data);
}

const sumOf = (entries: readonly { amount: string }[]): bigint =>
  entries.reduce((total, entry) => total + BigInt(entry.amount), 0n);

describe("Balancia backup adapter", () => {
  const parsed = balanciaJsonAdapter.parse(backup);
  const expenses = parsed.rows
    .map((entry) => entry.row)
    .filter((row): row is StagedExpense => row.kind === "expense");
  const settlements = parsed.rows
    .map((entry) => entry.row)
    .filter((row): row is StagedSettlement => row.kind === "settlement");

  it("recognises its own export by the envelope, not the file name", () => {
    expect(balanciaJsonAdapter.detect(backup, "anything.json")).toBe(true);
    expect(balanciaJsonAdapter.detect(backup, "anything.csv")).toBe(false);
    expect(balanciaJsonAdapter.detect('{"expenses":[]}', "other.json")).toBe(
      false,
    );
    expect(balanciaJsonAdapter.detect("not json", "other.json")).toBe(false);
  });

  it("is not mistaken for a Splitwise backup", () => {
    expect(splitwiseJsonAdapter.detect(backup, "backup.json")).toBe(false);
  });

  it("lists everyone in the group, including people with no expense", () => {
    expect(parsed.participants.map((entry) => entry.sourceName)).toEqual([
      "Ada",
      "Blaise",
      "Grace",
    ]);
    expect(parsed.participants[0].email).toBe("ada@example.test");
  });

  it("keeps amounts as the minor units they were written as", () => {
    const guesthouse = expenses[0];
    expect(guesthouse.amount).toBe("42000");
    expect(sumOf(guesthouse.payers)).toBe(42000n);
    expect(sumOf(guesthouse.shares)).toBe(42000n);
  });

  it("carries several payers across", () => {
    const tram = expenses[1];
    expect(tram.payers).toEqual([
      { sourceName: "Blaise", amount: "1000" },
      { sourceName: "Grace", amount: "800" },
    ]);
    expect(sumOf(tram.shares)).toBe(1800n);
  });

  it("keeps the category code the export wrote", () => {
    // The adapter is a reader, not a translator: it hands back exactly what
    // the file said, retired codes included. Migrating them is
    // `categorizeImportedExpense`'s job, one layer up — see
    // `imports/categories.test.ts`.
    expect(expenses.map((expense) => expense.category)).toEqual([
      "lodging",
      "transport",
      "travel",
    ]);
  });

  it("reads which way each entry moved money", () => {
    // The fixture predates income, so every entry in it is spending — which is
    // also what a backup that says nothing has to restore as.
    expect(expenses.map((expense) => expense.direction)).toEqual([
      "out",
      "out",
      "out",
    ]);

    const withIncome = balanciaJsonAdapter.parse(
      edited((data) => {
        data.expenses[1].direction = "in";
      }),
    );
    const restored = withIncome.rows
      .map((entry) => entry.row)
      .filter((row): row is StagedExpense => row.kind === "expense");
    expect(restored.map((row) => row.direction)).toEqual(["out", "in", "out"]);
  });

  it("reads a direction it does not recognise as spending", () => {
    const tampered = balanciaJsonAdapter.parse(
      edited((data) => {
        data.expenses[0].direction = "sideways";
      }),
    );
    // The row is otherwise whole; filing it as spending is what every backup
    // written before income already gets, and losing the entry would be worse.
    expect(tampered.rows).toHaveLength(4);
    expect((tampered.rows[0].row as StagedExpense).direction).toBe("out");
  });

  it("collects every currency used", () => {
    expect(parsed.currencies).toEqual(["EUR", "GBP"]);
  });

  it("reads a date whether or not it carries a time", () => {
    expect(expenses[2].date).toBe("2026-02-13");
  });

  it("turns settlements back into settlements, keeping the direction", () => {
    expect(settlements).toEqual([
      {
        kind: "settlement",
        date: "2026-02-20",
        amount: "14000",
        currency: "EUR",
        fromSourceName: "Blaise",
        toSourceName: "Ada",
        notes: "Paid the guesthouse share back",
      },
    ]);
  });

  it("says what a restore cannot bring back", () => {
    const messages = parsed.warnings.map((warning) => warning.message);
    expect(messages).toContainEqual(
      expect.stringContaining("Recurring expenses are not restored"),
    );
    expect(messages).toContainEqual(expect.stringContaining("Receipts"));
    expect(messages).toContainEqual(
      expect.stringContaining("Converted amounts are not restored"),
    );
    // Warnings about the file as a whole are not about any one row.
    for (const warning of parsed.warnings) {
      expect(warning.rowNumber).toBeNull();
    }
  });

  it("reports the source group and version in the preview", () => {
    expect(parsed.detected).toMatchObject({
      exportVersion: 1,
      sourceGroup: "Lisbon trip",
      importable: 4,
      recurringSkipped: 1,
    });
  });

  it("matches people by ID, so a rename between exports is still one person", () => {
    const renamed = balanciaJsonAdapter.parse(
      edited((data) => {
        data.expenses[0].payers[0].displayName = "Ada L.";
        data.expenses[0].shares[0].displayName = "Ada L.";
      }),
    );
    const first = renamed.rows[0].row as StagedExpense;
    expect(first.payers[0].sourceName).toBe("Ada");
    expect(renamed.participants).toHaveLength(3);
  });

  it("numbers people who share a display name instead of merging them", () => {
    const clash = balanciaJsonAdapter.parse(
      edited((data) => {
        data.participants[2].displayName = "Ada";
      }),
    );
    expect(clash.participants.map((entry) => entry.sourceName)).toEqual([
      "Ada",
      "Blaise",
      "Ada (2)",
    ]);
    const guesthouse = clash.rows[0].row as StagedExpense;
    expect(guesthouse.shares.map((share) => share.sourceName)).toEqual([
      "Ada",
      "Blaise",
      "Ada (2)",
    ]);
    expect(clash.warnings.map((warning) => warning.message)).toContainEqual(
      expect.stringContaining("share a display name"),
    );
  });

  it("skips a row whose shares no longer add up, and keeps the rest", () => {
    const tampered = balanciaJsonAdapter.parse(
      edited((data) => {
        data.expenses[0].shares[0].amount = "13000";
      }),
    );
    expect(tampered.rows).toHaveLength(3);
    expect(tampered.warnings.map((warning) => warning.message)).toContainEqual(
      expect.stringContaining("do not add up"),
    );
  });

  it("skips a row whose currency this instance does not know", () => {
    const tampered = balanciaJsonAdapter.parse(
      edited((data) => {
        data.expenses[0].currency = "ZZZ";
      }),
    );
    expect(tampered.rows).toHaveLength(3);
    expect(tampered.warnings.map((warning) => warning.message)).toContainEqual(
      expect.stringContaining("unsupported currency"),
    );
  });

  it("refuses a fractional amount rather than rounding it", () => {
    const tampered = balanciaJsonAdapter.parse(
      edited((data) => {
        data.expenses[0].amount = "420.00";
      }),
    );
    expect(tampered.rows).toHaveLength(3);
    expect(tampered.warnings.map((warning) => warning.message)).toContainEqual(
      expect.stringContaining("unreadable total"),
    );
  });

  it("refuses a backup written by a newer Balancia", () => {
    const newer = edited((data) => {
      data.balancia.exportVersion = 2;
    });
    expect(balanciaJsonAdapter.detect(newer, "backup.json")).toBe(true);
    expect(() => balanciaJsonAdapter.parse(newer)).toThrow(ImportParseError);
    expect(() => balanciaJsonAdapter.parse(newer)).toThrow(
      /newer version of Balancia/,
    );
  });

  it("refuses a JSON file that is not a Balancia export", () => {
    expect(() => balanciaJsonAdapter.parse('{"expenses":[]}')).toThrow(
      /not a Balancia export/,
    );
  });

  it("refuses a backup with nothing in it", () => {
    expect(() =>
      balanciaJsonAdapter.parse(
        JSON.stringify({
          balancia: {
            exportVersion: 1,
            exportedAt: "2026-03-04T09:15:00.000Z",
          },
          participants: [],
          expenses: [],
          settlements: [],
        }),
      ),
    ).toThrow(/nothing to import/);
  });

  it("still imports a group that has people but no transactions yet", () => {
    const empty = balanciaJsonAdapter.parse(
      edited((data) => {
        data.expenses = [];
        data.settlements = [];
        data.recurringExpenses = [];
      }),
    );
    expect(empty.rows).toHaveLength(0);
    expect(empty.participants).toHaveLength(3);
  });
});
