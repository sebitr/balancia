import { describe, expect, it } from "vitest";
import { splitwiseJsonAdapter } from "./splitwise-json";
import type { StagedExpense, StagedSettlement } from "./types";

/**
 * The Splitwise JSON adapter, on the rows a real backup can hold that the
 * database would refuse as written.
 */

const ada = { id: 1, first_name: "Ada", last_name: null };
const blaise = { id: 2, first_name: "Blaise", last_name: null };

interface Entry {
  cost: string;
  date?: string;
  payment?: boolean;
  description?: string;
  users: {
    user: { id: number; first_name: string; last_name: null };
    paid_share: string;
    owed_share: string;
  }[];
}

function parse(...entries: Entry[]) {
  return splitwiseJsonAdapter.parse(
    JSON.stringify({
      expenses: entries.map((entry, index) => ({
        id: index + 1,
        description: entry.description ?? "Dinner",
        currency_code: "EUR",
        date: entry.date ?? "2026-03-02T19:00:00Z",
        payment: entry.payment ?? false,
        ...entry,
      })),
    }),
  );
}

describe("Splitwise JSON adapter", () => {
  it("skips a date that has the right shape but is not a day", () => {
    const result = parse({
      cost: "10.00",
      date: "2024-02-30T12:00:00Z",
      users: [
        { user: ada, paid_share: "10.00", owed_share: "5.00" },
        { user: blaise, paid_share: "0.00", owed_share: "5.00" },
      ],
    });
    expect(result.rows).toHaveLength(0);
    expect(result.warnings[0].message).toMatch(/unreadable date/);
  });

  it("imports a negative cost as income, every amount positive", () => {
    // 30 came back to Ada, and it was the two of theirs: Splitwise writes her
    // paid share and both owed shares negative.
    const result = parse({
      cost: "-30.00",
      description: "Refund",
      users: [
        { user: ada, paid_share: "-30.00", owed_share: "-15.00" },
        { user: blaise, paid_share: "0.00", owed_share: "-15.00" },
      ],
    });
    const row = result.rows[0].row as StagedExpense;
    expect(result.warnings).toEqual([]);
    expect(row).toMatchObject({
      kind: "expense",
      direction: "in",
      amount: "3000",
      category: "refunds",
      payers: [{ sourceName: "Ada", amount: "3000" }],
      shares: [
        { sourceName: "Ada", amount: "1500" },
        { sourceName: "Blaise", amount: "1500" },
      ],
    });
  });

  it("reads a negative payment as the same payment the other way", () => {
    // Paid −20 by Ada, owed −20 by Blaise leaves Ada 20 down and Blaise 20 up —
    // which is Blaise handing Ada 20.
    const result = parse({
      cost: "-20.00",
      payment: true,
      users: [
        { user: ada, paid_share: "-20.00", owed_share: "0.00" },
        { user: blaise, paid_share: "0.00", owed_share: "-20.00" },
      ],
    });
    expect(result.rows[0].row as StagedSettlement).toMatchObject({
      kind: "settlement",
      amount: "2000",
      fromSourceName: "Blaise",
      toSourceName: "Ada",
    });
  });

  it("skips an entry whose shares pull in different directions", () => {
    // Adds up, but a negative paid share on a positive cost is a payment the
    // database refuses, and no direction describes the row.
    const result = parse({
      cost: "10.00",
      users: [
        { user: ada, paid_share: "20.00", owed_share: "5.00" },
        { user: blaise, paid_share: "-10.00", owed_share: "5.00" },
      ],
    });
    expect(result.rows).toHaveLength(0);
    expect(result.warnings[0].message).toMatch(/same way as its cost/);
  });

  it("skips an entry with nothing paid and nothing owed", () => {
    const result = parse({
      cost: "0.00",
      users: [
        { user: ada, paid_share: "0.00", owed_share: "0.00" },
        { user: blaise, paid_share: "0.00", owed_share: "0.00" },
      ],
    });
    expect(result.rows).toHaveLength(0);
    expect(result.warnings[0].message).toMatch(/names nobody/);
  });

  it("leaves an ordinary expense as spending", () => {
    const result = parse({
      cost: "10.00",
      users: [
        { user: ada, paid_share: "10.00", owed_share: "5.00" },
        { user: blaise, paid_share: "0.00", owed_share: "5.00" },
      ],
    });
    const row = result.rows[0].row as StagedExpense;
    expect(row.direction).toBeUndefined();
    expect(row.amount).toBe("1000");
  });
});
