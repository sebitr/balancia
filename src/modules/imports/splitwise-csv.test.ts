import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ImportParseError } from "./types";
import { splitwiseCsvAdapter } from "./splitwise-csv";
import type { StagedExpense, StagedSettlement } from "./types";

const fixture = (name: string): string =>
  readFileSync(
    path.join(process.cwd(), "tests/fixtures/splitwise", name),
    "utf8",
  );

const sumOf = (entries: readonly { amount: string }[]): bigint =>
  entries.reduce((total, entry) => total + BigInt(entry.amount), 0n);

describe("Splitwise CSV adapter", () => {
  const parsed = splitwiseCsvAdapter.parse(fixture("trip-group.csv"));

  it("detects a Splitwise export by its headers", () => {
    expect(
      splitwiseCsvAdapter.detect(fixture("trip-group.csv"), "export.csv"),
    ).toBe(true);
    expect(splitwiseCsvAdapter.detect("a,b,c\n1,2,3", "other.csv")).toBe(false);
    expect(
      splitwiseCsvAdapter.detect(fixture("trip-group.csv"), "export.json"),
    ).toBe(false);
  });

  it("finds the participants from the person columns", () => {
    expect(parsed.participants.map((p) => p.sourceName)).toEqual([
      "Ada",
      "Blaise",
      "Grace",
    ]);
  });

  it("collects the currencies used", () => {
    expect(parsed.currencies).toEqual(["EUR"]);
  });

  it("drops the trailing total-balance summary row", () => {
    const descriptions = parsed.rows
      .filter((entry) => entry.row.kind === "expense")
      .map((entry) => (entry.row as StagedExpense).description);
    expect(descriptions).not.toContain("Total balance");
    expect(descriptions).toEqual([
      "Groceries",
      "Taxi",
      "Museum tickets",
      "Dinner",
    ]);
  });

  it("reconstructs payers and shares that balance for a simple expense", () => {
    const groceries = parsed.rows.find(
      (entry) =>
        entry.row.kind === "expense" &&
        (entry.row as StagedExpense).description === "Groceries",
    )?.row as StagedExpense;

    expect(groceries.amount).toBe("6000");
    expect(groceries.currency).toBe("EUR");
    // Ada paid the full 60.00 and owes a third of it.
    expect(groceries.payers).toEqual([{ sourceName: "Ada", amount: "6000" }]);
    expect(sumOf(groceries.shares)).toBe(6000n);
    expect(groceries.shares).toEqual([
      { sourceName: "Ada", amount: "2000" },
      { sourceName: "Blaise", amount: "2000" },
      { sourceName: "Grace", amount: "2000" },
    ]);
  });

  it("keeps shares summing to the total when the split does not divide evenly", () => {
    const dinner = parsed.rows.find(
      (entry) =>
        entry.row.kind === "expense" &&
        (entry.row as StagedExpense).description === "Dinner",
    )?.row as StagedExpense;

    expect(dinner.amount).toBe("10000");
    expect(sumOf(dinner.shares)).toBe(10000n);
    expect(sumOf(dinner.payers)).toBe(10000n);
  });

  it("preserves the sum invariant on every imported expense", () => {
    for (const entry of parsed.rows) {
      if (entry.row.kind !== "expense") continue;
      const expense = entry.row;
      expect(sumOf(expense.shares)).toBe(BigInt(expense.amount));
      expect(sumOf(expense.payers)).toBe(BigInt(expense.amount));
    }
  });

  it("recognises a payment row as a settlement, not an expense", () => {
    const settlements = parsed.rows.filter(
      (entry) => entry.row.kind === "settlement",
    );
    expect(settlements).toHaveLength(1);
    const settlement = settlements[0].row as StagedSettlement;
    expect(settlement.fromSourceName).toBe("Ada");
    expect(settlement.toSourceName).toBe("Blaise");
    expect(settlement.amount).toBe("2500");
    expect(settlement.currency).toBe("EUR");
  });

  it("records the row number so the preview can point at the source line", () => {
    // Header is row 1, so the first data row is 2.
    expect(parsed.rows[0].rowNumber).toBe(2);
  });
});

describe("Splitwise CSV adapter — resilience", () => {
  it("rejects a file that is not a Splitwise export", () => {
    expect(() => splitwiseCsvAdapter.parse("Name,Total\nAda,10\n")).toThrow(
      ImportParseError,
    );
  });

  it("rejects an empty file", () => {
    expect(() => splitwiseCsvAdapter.parse("")).toThrow(ImportParseError);
  });

  it("rejects an export with no participant columns", () => {
    expect(() =>
      splitwiseCsvAdapter.parse(
        "Date,Description,Cost,Currency\n2026-01-01,X,5,EUR\n",
      ),
    ).toThrow(/participant columns/);
  });

  it("warns and skips rows with an unsupported currency instead of failing", () => {
    const result = splitwiseCsvAdapter.parse(
      [
        "Date,Description,Cost,Currency,Ada,Blaise",
        "2026-01-01,Good,10.00,EUR,5.00,-5.00",
        "2026-01-02,Bad,10.00,XXX,5.00,-5.00",
        "",
      ].join("\n"),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toMatch(/unsupported currency/);
    expect(result.warnings[0].rowNumber).toBe(3);
  });

  it("warns and skips rows with an unreadable amount", () => {
    const result = splitwiseCsvAdapter.parse(
      [
        "Date,Description,Cost,Currency,Ada,Blaise",
        "2026-01-01,Broken,not-a-number,EUR,5.00,-5.00",
        "",
      ].join("\n"),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.warnings[0].message).toMatch(/unreadable amount/);
  });

  it("handles a column layout without Category", () => {
    const result = splitwiseCsvAdapter.parse(
      [
        "Date,Description,Cost,Currency,Ada,Blaise",
        "2026-01-01,Coffee,10.00,EUR,5.00,-5.00",
        "",
      ].join("\n"),
    );
    expect(result.rows).toHaveLength(1);
    expect((result.rows[0].row as StagedExpense).category).toBeNull();
  });

  it("handles zero-decimal currencies", () => {
    const result = splitwiseCsvAdapter.parse(
      [
        "Date,Description,Cost,Currency,Ada,Blaise",
        "2026-01-01,Ramen,1500,JPY,750,-750",
        "",
      ].join("\n"),
    );
    const expense = result.rows[0].row as StagedExpense;
    // No phantom minor units for JPY.
    expect(expense.amount).toBe("1500");
    expect(sumOf(expense.shares)).toBe(1500n);
  });

  it("accepts semicolon-delimited exports with decimal commas", () => {
    // Splitwise exports from decimal-comma locales use ';' as the separator.
    const result = splitwiseCsvAdapter.parse(
      [
        "Date;Description;Cost;Currency;Ada;Blaise",
        "2026-01-01;Coffee;10,50;EUR;5,25;-5,25",
        "",
      ].join("\n"),
    );
    const expense = result.rows[0].row as StagedExpense;
    expect(expense.amount).toBe("1050");
    expect(sumOf(expense.shares)).toBe(1050n);
  });

  it("still reads a comma-delimited export with dot decimals", () => {
    const result = splitwiseCsvAdapter.parse(
      [
        "Date,Description,Cost,Currency,Ada,Blaise",
        "2026-01-01,Coffee,10.50,EUR,5.25,-5.25",
        "",
      ].join("\n"),
    );
    expect((result.rows[0].row as StagedExpense).amount).toBe("1050");
  });
});
