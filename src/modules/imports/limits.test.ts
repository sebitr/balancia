import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addParticipantSchema } from "@/modules/groups/schemas";
import {
  expenseInputSchema,
  minorUnitsString,
  settlementInputSchema,
} from "@/modules/expenses/schemas";
import { balanciaJsonAdapter } from "./balancia-json";
import {
  IMPORT_TEXT_LIMITS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_MINOR_UNITS,
  fitText,
  fitToImportLimits,
  isCalendarDate,
} from "./limits";
import { splitwiseCsvAdapter } from "./splitwise-csv";
import type { StagedExpense } from "./types";

describe("isCalendarDate", () => {
  it("accepts days that exist, leap days included", () => {
    for (const day of [
      "2026-01-31",
      "2024-02-29",
      "2000-02-29",
      "0001-01-01",
    ]) {
      expect(isCalendarDate(day), day).toBe(true);
    }
  });

  it("refuses what PostgreSQL would refuse at commit", () => {
    for (const day of [
      "2024-02-30",
      "2023-02-29",
      "1900-02-29",
      "2024-04-31",
      "2024-13-01",
      "2024-00-10",
      "2024-01-00",
      "0000-01-01",
      "2024-1-01",
      "24-01-01",
    ]) {
      expect(isCalendarDate(day), day).toBe(false);
    }
  });
});

describe("fitText", () => {
  it("leaves text that fits alone", () => {
    expect(fitText("Groceries", 200)).toBe("Groceries");
    expect(fitText("x".repeat(200), 200)).toHaveLength(200);
  });

  it("cuts to the limit and marks the cut", () => {
    const cut = fitText("word ".repeat(100), 200);
    expect(cut).toHaveLength(200);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("never leaves half an emoji behind", () => {
    // 198 letters, then an emoji whose two halves straddle the cut.
    const cut = fitText(`${"a".repeat(198)}😀😀😀`, 200);
    expect(cut.length).toBeLessThanOrEqual(200);
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("the limits agree with the forms", () => {
  // An imported row that is longer than the form allows cannot be saved the
  // first time somebody edits it. These pin the numbers to the schemas that
  // will judge it, so neither can move without the other.
  const fits = (
    schema: { safeParse: (value: unknown) => { success: boolean } },
    limit: number,
  ) => [
    schema.safeParse("x".repeat(limit)).success,
    schema.safeParse("x".repeat(limit + 1)).success,
  ];

  it("for descriptions, notes, categories and names", () => {
    expect(
      fits(
        expenseInputSchema.shape.description,
        IMPORT_TEXT_LIMITS.description,
      ),
    ).toEqual([true, false]);
    expect(
      fits(expenseInputSchema.shape.notes, IMPORT_TEXT_LIMITS.notes),
    ).toEqual([true, false]);
    expect(
      fits(settlementInputSchema.shape.notes, IMPORT_TEXT_LIMITS.notes),
    ).toEqual([true, false]);
    expect(
      fits(expenseInputSchema.shape.category, IMPORT_TEXT_LIMITS.category),
    ).toEqual([true, false]);
    expect(
      fits(
        addParticipantSchema.shape.displayName,
        IMPORT_TEXT_LIMITS.displayName,
      ),
    ).toEqual([true, false]);
  });

  it("for amounts", () => {
    expect(
      minorUnitsString.safeParse(String(MAX_IMPORT_MINOR_UNITS)).success,
    ).toBe(true);
    expect(
      minorUnitsString.safeParse(String(MAX_IMPORT_MINOR_UNITS + 1n)).success,
    ).toBe(false);
    // And inside what a `bigint` column holds.
    expect(MAX_IMPORT_MINOR_UNITS).toBeLessThan(2n ** 63n);
  });
});

describe("the file ceiling", () => {
  it("fits inside the Server Action body limit, with room for the framing", () => {
    // The upload is a Server Action, and next.config.ts caps its body. A file
    // allowed here but refused there fails with a framework error nobody can
    // act on — which is what a 10 MiB ceiling over a 1 MB body used to do.
    const config = readFileSync(
      path.join(process.cwd(), "next.config.ts"),
      "utf8",
    );
    const declared = /bodySizeLimit:\s*"(\d+)mb"/.exec(config);
    expect(
      declared,
      "serverActions.bodySizeLimit in next.config.ts",
    ).not.toBeNull();
    const bodyLimit = Number(declared![1]) * 1024 * 1024;

    // Next's own docs: allow 10–20 KB for the multipart boundaries and headers.
    expect(MAX_IMPORT_BYTES + 20 * 1024).toBeLessThanOrEqual(bodyLimit);
  });
});

describe("fitToImportLimits", () => {
  it("drops a row whose amount the database could not hold, and says so", () => {
    // A Balancia backup is a file somebody can edit. Twenty digits of minor
    // units is past the form's ceiling and past `bigint` altogether.
    const huge = "99999999999999999999";
    const backup = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "tests/fixtures/balancia/trip-group.json"),
        "utf8",
      ),
    ) as {
      expenses: {
        amount: string;
        payers: { amount: string }[];
        shares: { amount: string }[];
      }[];
    };
    const first = backup.expenses[0];
    first.amount = huge;
    first.payers = [{ ...first.payers[0], amount: huge }];
    first.shares = [{ ...first.shares[0], amount: huge }];

    const parsed = balanciaJsonAdapter.parse(JSON.stringify(backup));
    expect(parsed.rows.some((entry) => entry.row.amount === huge)).toBe(true);

    const fitted = fitToImportLimits(parsed);
    expect(fitted.rows).toHaveLength(parsed.rows.length - 1);
    expect(fitted.rows.some((entry) => entry.row.amount === huge)).toBe(false);
    expect(fitted.warnings).toContainEqual(
      expect.objectContaining({
        rowNumber: 1,
        message: "Skipped a row with an amount too large to record",
      }),
    );
  });

  it("drops an over-range amount from a Splitwise export too", () => {
    const parsed = splitwiseCsvAdapter.parse(
      [
        "Date,Description,Cost,Currency,Ada,Blaise",
        "2026-01-01,Coffee,10.00,EUR,5.00,-5.00",
        "2026-01-02,Yacht,99999999999999999999.00,EUR,50000000000000000000.00,-50000000000000000000.00",
        "",
      ].join("\n"),
    );
    const fitted = fitToImportLimits(parsed);
    expect(fitted.rows.map((entry) => entry.rowNumber)).toEqual([2]);
    expect(fitted.warnings.map((warning) => warning.rowNumber)).toEqual([3]);
  });

  it("shortens text past the forms' limits, keeping the row and the original", () => {
    const description = "Weekend in the Alps ".repeat(15).trim();
    const notes = "n".repeat(2500);
    const category =
      "A category label far longer than any form would ever take";
    const parsed = {
      ...splitwiseCsvAdapter.parse(
        [
          "Date,Description,Category,Cost,Currency,Ada,Blaise",
          `2026-01-01,${description},${category}xxxx,20.00,EUR,10.00,-10.00`,
          "",
        ].join("\n"),
      ),
    };
    const staged = parsed.rows[0].row as StagedExpense;
    const withNotes = {
      ...parsed,
      rows: [{ rowNumber: 2, row: { ...staged, notes } }],
    };

    const fitted = fitToImportLimits(withNotes);
    const row = fitted.rows[0].row as StagedExpense;

    expect(row.description).toHaveLength(IMPORT_TEXT_LIMITS.description);
    expect(row.notes).toHaveLength(IMPORT_TEXT_LIMITS.notes);
    expect(row.category).toHaveLength(IMPORT_TEXT_LIMITS.category);
    expect(row.amount).toBe(staged.amount);
    expect((fitted.rows[0].source as StagedExpense).description).toBe(
      description,
    );
    expect(fitted.warnings.map((warning) => warning.message)).toEqual([
      "Shortened a description longer than 200 characters",
      "Shortened a note longer than 2,000 characters",
      "Shortened a category longer than 60 characters",
    ]);
  });

  it("warns about a name too long to be a person's, without renaming the key", () => {
    const name = "Ada ".repeat(40).trim();
    const parsed = splitwiseCsvAdapter.parse(
      [
        `Date,Description,Cost,Currency,${name},Blaise`,
        "2026-01-01,Coffee,10.00,EUR,5.00,-5.00",
        "",
      ].join("\n"),
    );

    const fitted = fitToImportLimits(parsed);

    expect(fitted.warnings).toEqual([
      expect.objectContaining({
        rowNumber: null,
        message: expect.stringMatching(/name longer than 120 characters/),
      }),
    ]);
    // The mapping and the fingerprint are keyed on it, so it stays whole here.
    const row = fitted.rows[0].row as StagedExpense;
    expect(row.payers[0].sourceName).toBe(name);
  });

  it("changes nothing in a file that fits", () => {
    const parsed = splitwiseCsvAdapter.parse(
      readFileSync(
        path.join(process.cwd(), "tests/fixtures/splitwise/trip-group.csv"),
        "utf8",
      ),
    );
    const fitted = fitToImportLimits(parsed);
    expect(fitted.warnings).toEqual([]);
    expect(fitted.rows.map((entry) => entry.row)).toEqual(
      parsed.rows.map((entry) => entry.row),
    );
  });
});
