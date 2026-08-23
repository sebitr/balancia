import { describe, expect, it } from "vitest";
import {
  computeGroupStats,
  type GroupStatsEntryFact,
  type GroupStatsInput,
} from "./group-stats";
import type { StatsSettlementFact } from "./member-stats";

/**
 * The statistics a group screen reads.
 *
 * The arithmetic worth pinning here is the arithmetic nobody sees go wrong: a
 * repayment counted as spending, an income folded into a total, a category
 * whose children no longer add up to it, a retired code drawn under a name the
 * picker stopped offering, and two currencies quietly added together.
 */

const NAMES = new Map([
  ["nora", "Nora"],
  ["ines", "Inès"],
  ["tomas", "Tomas"],
]);

const MEMBERS = ["nora", "ines", "tomas"];

const NOW = new Date("2026-08-21T12:00:00Z");

function entry(
  overrides: Partial<GroupStatsEntryFact> & {
    payers: GroupStatsEntryFact["payers"];
    shares: GroupStatsEntryFact["shares"];
  },
): GroupStatsEntryFact {
  return {
    id: overrides.id ?? `e${Math.random()}`,
    description: overrides.description ?? "Groceries",
    // `??` would turn a deliberate `null` back into a category, which is the
    // one case the split has to be able to express.
    category:
      overrides.category === undefined ? "groceries" : overrides.category,
    subcategory:
      overrides.subcategory === undefined ? null : overrides.subcategory,
    direction: overrides.direction ?? "out",
    expenseDate: overrides.expenseDate ?? "2026-08-01",
    createdAt: overrides.createdAt ?? new Date("2026-08-01T10:00:00Z"),
    currency: overrides.currency ?? "EUR",
    payers: overrides.payers,
    shares: overrides.shares,
  };
}

function settlement(
  overrides: Partial<StatsSettlementFact> & { amount: bigint },
): StatsSettlementFact {
  return {
    id: overrides.id ?? `s${Math.random()}`,
    settledOn: overrides.settledOn ?? "2026-08-10",
    createdAt: overrides.createdAt ?? new Date("2026-08-10T10:00:00Z"),
    currency: overrides.currency ?? "EUR",
    fromParticipantId: overrides.fromParticipantId ?? "ines",
    toParticipantId: overrides.toParticipantId ?? "nora",
    amount: overrides.amount,
  };
}

function input(
  overrides: Partial<GroupStatsInput> & {
    facts: readonly GroupStatsEntryFact[];
  },
): GroupStatsInput {
  return {
    settlements: [],
    names: NAMES,
    memberIds: MEMBERS,
    openBalances: new Map(),
    selfParticipantId: "nora",
    timezone: "Europe/Zurich",
    now: NOW,
    ...overrides,
  };
}

/** The `1y` window, which every fixture here sits inside. */
function year(stats: ReturnType<typeof computeGroupStats>) {
  const range = stats.ranges.find((candidate) => candidate.key === "1y");
  if (!range) throw new Error("no 1y range");
  return range;
}

function eur(stats: ReturnType<typeof computeGroupStats>) {
  const currency = year(stats).currencies.find(
    (candidate) => candidate.currency === "EUR",
  );
  if (!currency) throw new Error("no EUR block");
  return currency;
}

describe("computeGroupStats", () => {
  it("leaves settlements out of what the group spent", () => {
    const stats = computeGroupStats(
      input({
        facts: [
          entry({
            payers: [{ participantId: "nora", amount: 6000n }],
            shares: [
              { participantId: "nora", amount: 3000n },
              { participantId: "ines", amount: 3000n },
            ],
          }),
        ],
        settlements: [settlement({ amount: 3000n })],
      }),
    );

    const block = eur(stats);
    expect(block.totalSpent).toBe(6000n);
    expect(block.entryCount).toBe(1);
    // The repayment is reported, but only as what it is: money that moved
    // between two members.
    expect(block.flows.settled).toBe(3000n);
    expect(block.flows.settledCount).toBe(1);
    expect(block.flows.spent).toBe(6000n);
  });

  it("reports income beside spending rather than inside it", () => {
    const stats = computeGroupStats(
      input({
        facts: [
          entry({
            payers: [{ participantId: "nora", amount: 10000n }],
            shares: [{ participantId: "nora", amount: 10000n }],
          }),
          entry({
            direction: "in",
            description: "Deposit back",
            payers: [{ participantId: "ines", amount: 2500n }],
            shares: [{ participantId: "ines", amount: 2500n }],
          }),
        ],
      }),
    );

    const block = eur(stats);
    expect(block.totalSpent).toBe(10000n);
    expect(block.entryCount).toBe(1);
    expect(block.flows.revenue).toBe(2500n);
    expect(block.flows.revenueCount).toBe(1);
    // The netted figure is the toggle's, and only the toggle's.
    expect(block.netTotalSpent).toBe(7500n);
    expect(block.categories.reduce((sum, one) => sum + one.amount, 0n)).toBe(
      10000n,
    );
  });

  it("reconciles a category's subcategories with the category", () => {
    const stats = computeGroupStats(
      input({
        facts: [
          entry({
            category: "home",
            subcategory: "rent",
            payers: [{ participantId: "nora", amount: 120000n }],
            shares: [{ participantId: "nora", amount: 120000n }],
          }),
          entry({
            category: "home",
            subcategory: "electricity",
            payers: [{ participantId: "ines", amount: 7130n }],
            shares: [{ participantId: "ines", amount: 7130n }],
          }),
          entry({
            category: "home",
            subcategory: null,
            payers: [{ participantId: "tomas", amount: 1547n }],
            shares: [{ participantId: "tomas", amount: 1547n }],
          }),
        ],
      }),
    );

    const home = eur(stats).categories.find((one) => one.category === "home");
    expect(home).toBeDefined();
    const children = home!.children.reduce(
      (sum, child) => sum + child.amount,
      0n,
    );
    expect(children + home!.remainder).toBe(home!.amount);
    expect(home!.remainder).toBe(1547n);
    expect(home!.children.map((child) => child.subcategory)).toEqual([
      "rent",
      "electricity",
    ]);
  });

  it("files a retired code under the category it became", () => {
    const stats = computeGroupStats(
      input({
        facts: [
          entry({
            category: "utilities",
            subcategory: "electricity",
            payers: [{ participantId: "nora", amount: 5000n }],
            shares: [{ participantId: "nora", amount: 5000n }],
          }),
          entry({
            category: "housing",
            subcategory: "rent",
            payers: [{ participantId: "nora", amount: 90000n }],
            shares: [{ participantId: "nora", amount: 90000n }],
          }),
        ],
      }),
    );

    const categories = eur(stats).categories;
    expect(categories.map((one) => one.category)).toEqual(["home"]);
    expect(categories[0].amount).toBe(95000n);
    expect(categories[0].children.map((child) => child.subcategory)).toEqual([
      "rent",
      "electricity",
    ]);
  });

  it("keeps a subcategory its parent no longer admits out of the children", () => {
    const stats = computeGroupStats(
      input({
        facts: [
          entry({
            // `travel` retired to `other`, which has no second level at all.
            category: "travel",
            subcategory: "flights",
            payers: [{ participantId: "nora", amount: 42000n }],
            shares: [{ participantId: "nora", amount: 42000n }],
          }),
        ],
      }),
    );

    const other = eur(stats).categories.find((one) => one.category === "other");
    expect(other).toBeDefined();
    expect(other!.children).toEqual([]);
    expect(other!.remainder).toBe(42000n);
  });

  it("gives each member paid, share and net over the window", () => {
    const stats = computeGroupStats(
      input({
        facts: [
          entry({
            payers: [{ participantId: "nora", amount: 9000n }],
            shares: [
              { participantId: "nora", amount: 3000n },
              { participantId: "ines", amount: 3000n },
              { participantId: "tomas", amount: 3000n },
            ],
          }),
        ],
      }),
    );

    const members = eur(stats).members;
    const nora = members.find((one) => one.participantId === "nora");
    expect(nora).toMatchObject({
      paid: 9000n,
      share: 3000n,
      net: 6000n,
      isSelf: true,
    });
    expect(members.find((one) => one.participantId === "ines")).toMatchObject({
      paid: 0n,
      share: 3000n,
      net: -3000n,
    });
  });

  it("reads what is open today from the balances it was given", () => {
    const stats = computeGroupStats(
      input({
        facts: [
          entry({
            payers: [{ participantId: "nora", amount: 9000n }],
            shares: [
              { participantId: "nora", amount: 3000n },
              { participantId: "ines", amount: 3000n },
              { participantId: "tomas", amount: 3000n },
            ],
          }),
        ],
        openBalances: new Map([
          [
            "EUR",
            new Map([
              ["nora", 6000n],
              ["ines", -3000n],
              ["tomas", -3000n],
            ]),
          ],
        ]),
      }),
    );

    const members = eur(stats).members;
    expect(members.reduce((sum, one) => sum + one.open, 0n)).toBe(0n);
    expect(members.find((one) => one.participantId === "nora")?.open).toBe(
      6000n,
    );
  });

  it("keeps two currencies apart instead of adding them", () => {
    const stats = computeGroupStats(
      input({
        facts: [
          entry({
            currency: "EUR",
            payers: [{ participantId: "nora", amount: 10000n }],
            shares: [{ participantId: "nora", amount: 10000n }],
          }),
          entry({
            currency: "CHF",
            payers: [{ participantId: "ines", amount: 4000n }],
            shares: [{ participantId: "ines", amount: 4000n }],
          }),
        ],
      }),
    );

    expect(stats.currencies).toEqual(["EUR", "CHF"]);
    const blocks = year(stats).currencies;
    expect(blocks.map((block) => block.totalSpent)).toEqual([10000n, 4000n]);
  });

  it("reports the median entry, which one big bill does not move", () => {
    const amounts = [1000n, 2000n, 3000n, 90000n];
    const stats = computeGroupStats(
      input({
        facts: amounts.map((amount) =>
          entry({
            payers: [{ participantId: "nora", amount }],
            shares: [{ participantId: "nora", amount }],
          }),
        ),
      }),
    );

    const block = eur(stats);
    expect(block.totalSpent).toBe(96000n);
    // The middle two, averaged — not 24,000, which is the mean.
    expect(block.medianEntry).toBe(2500n);
  });

  it("counts entries by weekday, quiet days included", () => {
    const stats = computeGroupStats(
      input({
        facts: [
          // A Saturday and a Sunday in the same week.
          entry({
            expenseDate: "2026-08-15",
            payers: [{ participantId: "nora", amount: 1000n }],
            shares: [{ participantId: "nora", amount: 1000n }],
          }),
          entry({
            expenseDate: "2026-08-15",
            payers: [{ participantId: "nora", amount: 2000n }],
            shares: [{ participantId: "nora", amount: 2000n }],
          }),
          entry({
            expenseDate: "2026-08-16",
            payers: [{ participantId: "ines", amount: 500n }],
            shares: [{ participantId: "ines", amount: 500n }],
          }),
        ],
      }),
    );

    const weekdays = eur(stats).weekdays;
    expect(weekdays).toHaveLength(7);
    expect(weekdays.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(weekdays[5]).toMatchObject({ entryCount: 2, amount: 3000n });
    expect(weekdays[6]).toMatchObject({ entryCount: 1, amount: 500n });
    expect(weekdays[0].entryCount).toBe(0);
  });

  it("names the group's own records", () => {
    const stats = computeGroupStats(
      input({
        facts: [
          entry({
            description: "Sofa",
            category: "home",
            subcategory: "furniture",
            expenseDate: "2026-03-04",
            payers: [{ participantId: "nora", amount: 42890n }],
            shares: [
              { participantId: "nora", amount: 21445n },
              { participantId: "ines", amount: 21445n },
            ],
          }),
          entry({
            expenseDate: "2026-05-02",
            payers: [{ participantId: "ines", amount: 1000n }],
            shares: [{ participantId: "ines", amount: 1000n }],
          }),
        ],
        settlements: [
          settlement({
            settledOn: "2026-03-20",
            amount: 21445n,
            fromParticipantId: "ines",
            toParticipantId: "nora",
          }),
        ],
      }),
    );

    const records = stats.records.find((one) => one.currency === "EUR");
    expect(records?.biggestEntry).toMatchObject({
      description: "Sofa",
      amount: 42890n,
      paidBy: "Nora",
      category: "home",
      subcategory: "furniture",
    });
    // Owing from the sofa to the repayment that cleared it.
    expect(records?.longestOpen).toMatchObject({
      from: "2026-03-04",
      to: "2026-03-20",
      days: 16,
    });
    expect(records?.busiestWeek?.entryCount).toBe(1);
    expect(records?.quietestMonth?.entryCount).toBe(0);
  });

  it("says nothing about a trend it cannot see", () => {
    const stats = computeGroupStats(
      input({
        facts: [
          entry({
            payers: [{ participantId: "nora", amount: 1000n }],
            shares: [{ participantId: "nora", amount: 1000n }],
          }),
        ],
      }),
    );

    // One month of data is one bucket, and three of one bucket is not a trend.
    expect(eur(stats).trendPercent).toBeNull();
  });

  it("has nothing to report for a group with no entries", () => {
    const stats = computeGroupStats(input({ facts: [] }));
    expect(stats.currencies).toEqual([]);
    expect(stats.firstEntry).toBeNull();
    expect(stats.ranges).toHaveLength(3);
    expect(stats.ranges.every((range) => range.currencies.length === 0)).toBe(
      true,
    );
  });
});
