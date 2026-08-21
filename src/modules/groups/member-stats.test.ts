import { describe, expect, it } from "vitest";
import {
  bucketsFor,
  computeMemberStats,
  payerIndexOf,
  percentOf,
  windowOf,
  type MemberStatsInput,
  type StatsEntryFact,
  type StatsSettlementFact,
} from "./member-stats";

/**
 * The statistics a member screen reads.
 *
 * What is worth pinning here is the arithmetic nobody sees go wrong: a
 * settlement quietly counted as spending, a currency added to another one, a
 * bucket that swallows an entry that fell outside it, and a record computed
 * from today's balance rather than from the history that produced it.
 */

const NAMES = new Map([
  ["nora", "Nora"],
  ["ines", "Inès"],
  ["tomas", "Tomas"],
]);

const NOW = new Date("2026-08-21T12:00:00Z");

function entry(
  overrides: Partial<StatsEntryFact> & {
    payers: StatsEntryFact["payers"];
    shares: StatsEntryFact["shares"];
  },
): StatsEntryFact {
  return {
    id: overrides.id ?? `e${Math.random()}`,
    description: overrides.description ?? "Groceries",
    // `??` would turn a deliberate `null` back into a category, which is the
    // one case the category split needs to be able to express.
    category:
      overrides.category === undefined ? "groceries" : overrides.category,
    direction: overrides.direction ?? "out",
    expenseDate: overrides.expenseDate ?? "2026-08-01",
    createdAt: overrides.createdAt ?? new Date("2026-08-01T10:00:00Z"),
    currency: overrides.currency ?? "EUR",
    payers: overrides.payers,
    shares: overrides.shares,
  };
}

function input(
  overrides: Partial<MemberStatsInput> & {
    facts: readonly StatsEntryFact[];
  },
): MemberStatsInput {
  return {
    settlements: [],
    participantId: "nora",
    names: NAMES,
    memberCount: 3,
    timezone: "Europe/Zurich",
    now: NOW,
    ...overrides,
  };
}

/** Nora pays, the three of them split it evenly. */
function split(
  amount: bigint,
  overrides: Partial<StatsEntryFact> = {},
): StatsEntryFact {
  const each = amount / 3n;
  return entry({
    ...overrides,
    payers: [{ participantId: "nora", amount }],
    shares: [
      { participantId: "nora", amount: each },
      { participantId: "ines", amount: each },
      { participantId: "tomas", amount: amount - each * 2n },
    ],
  });
}

describe("percentages and the payer index", () => {
  it("rounds a percentage half-up to one decimal", () => {
    expect(percentOf(1n, 3n)).toBe(33.3);
    expect(percentOf(2n, 3n)).toBe(66.7);
    expect(percentOf(1n, 8n)).toBe(12.5);
  });

  it("reports nothing rather than zero when there is no whole", () => {
    expect(percentOf(500n, 0n)).toBe(0);
    expect(payerIndexOf(500n, 0n)).toBeNull();
  });

  it("divides paid by share to two decimals", () => {
    expect(payerIndexOf(169n, 100n)).toBe(1.69);
    expect(payerIndexOf(100n, 100n)).toBe(1);
    expect(payerIndexOf(0n, 100n)).toBe(0);
  });
});

describe("windows and buckets", () => {
  it("ends the window tomorrow, so today's entries are inside it", () => {
    const { from, to } = windowOf("3m", "Europe/Zurich", NOW);
    expect(from).toBe("2026-05-21");
    expect(to).toBe("2026-08-22");
  });

  it("leaves all time open at the start", () => {
    expect(windowOf("all", "Europe/Zurich", NOW).from).toBeNull();
  });

  it("builds a bucket per calendar step, gaps included", () => {
    const months = bucketsFor(
      "month",
      "2026-05-04",
      "2026-08-22",
      "Europe/Zurich",
    );
    expect(months).toEqual([
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
    ]);

    const quarters = bucketsFor(
      "quarter",
      "2025-02-10",
      "2026-08-22",
      "Europe/Zurich",
    );
    expect(quarters).toEqual([
      "2025-01-01",
      "2025-04-01",
      "2025-07-01",
      "2025-10-01",
      "2026-01-01",
      "2026-04-01",
      "2026-07-01",
    ]);
  });
});

describe("what a member put in against what was theirs", () => {
  it("separates paid from share, and counts the entries", () => {
    const stats = computeMemberStats(
      input({ facts: [split(9000n), split(3000n)] }),
    );
    const year = stats.ranges.find((range) => range.key === "1y");
    const eur = year?.currencies[0];

    expect(eur?.currency).toBe("EUR");
    expect(eur?.paid).toBe(12000n);
    expect(eur?.share).toBe(4000n);
    expect(eur?.entryCount).toBe(2);
    expect(eur?.groupSpent).toBe(12000n);
    expect(eur?.payerIndex).toBe(3);
    expect(eur?.sharePercent).toBe(33.3);
  });

  it("leaves income out of spending", () => {
    const stats = computeMemberStats(
      input({
        facts: [
          split(9000n),
          split(3000n, { direction: "in", description: "Deposit back" }),
        ],
      }),
    );
    const all = stats.ranges.find((range) => range.key === "all");

    expect(all?.currencies[0].paid).toBe(9000n);
    expect(all?.currencies[0].entryCount).toBe(1);
  });

  it("keeps currencies apart instead of adding them", () => {
    const stats = computeMemberStats(
      input({
        facts: [split(9000n), split(6000n, { currency: "CHF" })],
      }),
    );
    const all = stats.ranges.find((range) => range.key === "all");

    expect(all?.currencies.map((entry) => entry.currency)).toEqual([
      "EUR",
      "CHF",
    ]);
    expect(all?.currencies[0].paid).toBe(9000n);
    expect(all?.currencies[1].paid).toBe(6000n);
  });

  it("drops entries that fall outside the window", () => {
    const stats = computeMemberStats(
      input({
        facts: [
          split(9000n, { expenseDate: "2026-08-01" }),
          split(3000n, { expenseDate: "2025-01-15" }),
        ],
      }),
    );

    expect(stats.ranges.find((r) => r.key === "3m")?.currencies[0].paid).toBe(
      9000n,
    );
    expect(stats.ranges.find((r) => r.key === "all")?.currencies[0].paid).toBe(
      12000n,
    );
  });

  it("ranks members by what they carried, and says what an even split would be", () => {
    const stats = computeMemberStats(
      input({
        facts: [
          entry({
            payers: [{ participantId: "nora", amount: 10000n }],
            shares: [
              { participantId: "nora", amount: 2000n },
              { participantId: "ines", amount: 5000n },
              { participantId: "tomas", amount: 3000n },
            ],
          }),
        ],
      }),
    );
    const eur = stats.ranges.find((r) => r.key === "all")?.currencies[0];

    expect(eur?.members.map((member) => member.participantId)).toEqual([
      "ines",
      "tomas",
      "nora",
    ]);
    expect(eur?.rank).toBe(3);
    expect(eur?.sharePercent).toBe(20);
    expect(eur?.medianPercent).toBe(30);
    expect(eur?.evenPercent).toBe(33.3);
  });

  it("counts a partner once however many ways they are on an entry", () => {
    const stats = computeMemberStats(
      input({
        facts: [
          entry({
            payers: [
              { participantId: "nora", amount: 6000n },
              { participantId: "ines", amount: 3000n },
            ],
            shares: [
              { participantId: "nora", amount: 4500n },
              { participantId: "ines", amount: 4500n },
            ],
          }),
        ],
      }),
    );
    const partners =
      stats.ranges.find((r) => r.key === "all")?.currencies[0].partners ?? [];

    expect(partners).toHaveLength(1);
    expect(partners[0]).toMatchObject({
      participantId: "ines",
      entryCount: 1,
      amount: 9000n,
    });
  });

  it("splits the share by category, largest first", () => {
    const stats = computeMemberStats(
      input({
        facts: [
          split(3000n, { category: "groceries" }),
          split(9000n, { category: "housing" }),
          split(1500n, { category: null }),
        ],
      }),
    );
    const categories =
      stats.ranges.find((r) => r.key === "all")?.currencies[0].categories ?? [];

    expect(categories.map((slice) => slice.category)).toEqual([
      "housing",
      "groceries",
      null,
    ]);
    expect(categories[0].amount).toBe(3000n);
  });
});

describe("the activity heatmap", () => {
  it("fills every one of the 182 days, and measures the runs", () => {
    const stats = computeMemberStats(
      input({
        facts: [
          split(3000n, { expenseDate: "2026-08-19" }),
          split(3000n, { expenseDate: "2026-08-20" }),
          split(3000n, { expenseDate: "2026-08-20" }),
          split(3000n, { expenseDate: "2026-08-21" }),
        ],
      }),
    );

    expect(stats.activity.days).toHaveLength(182);
    expect(stats.activity.days.at(-1)?.date).toBe("2026-08-21");
    expect(stats.activity.days.at(-2)?.count).toBe(2);
    expect(stats.activity.longestRun).toBe(3);
    expect(stats.activity.currentRun).toBe(3);
  });

  it("closes the current run when the last day is quiet", () => {
    const stats = computeMemberStats(
      input({ facts: [split(3000n, { expenseDate: "2026-08-10" })] }),
    );

    expect(stats.activity.longestRun).toBe(1);
    expect(stats.activity.currentRun).toBe(0);
  });
});

describe("all-time records", () => {
  const settlement = (
    overrides: Partial<StatsSettlementFact>,
  ): StatsSettlementFact => ({
    id: "s1",
    settledOn: "2026-02-06",
    createdAt: new Date("2026-02-06T09:00:00Z"),
    currency: "EUR",
    fromParticipantId: "nora",
    toParticipantId: "ines",
    amount: 1000n,
    ...overrides,
  });

  it("names the biggest bill they put their own money into", () => {
    const stats = computeMemberStats(
      input({
        facts: [
          split(9000n, { description: "Sofa", category: "household" }),
          entry({
            description: "Somebody else's",
            payers: [{ participantId: "ines", amount: 50000n }],
            shares: [{ participantId: "ines", amount: 50000n }],
          }),
        ],
      }),
    );

    expect(stats.records[0].biggestBill).toMatchObject({
      description: "Sofa",
      category: "household",
      amount: 9000n,
    });
  });

  it("measures the longest stretch they were not square, even once cleared", () => {
    const stats = computeMemberStats(
      input({
        participantId: "ines",
        facts: [
          entry({
            expenseDate: "2026-01-03",
            payers: [{ participantId: "nora", amount: 1000n }],
            shares: [{ participantId: "ines", amount: 1000n }],
          }),
        ],
        settlements: [
          settlement({
            settledOn: "2026-02-06",
            fromParticipantId: "ines",
            toParticipantId: "nora",
          }),
        ],
      }),
    );

    expect(stats.records[0].longestDebt).toEqual({
      from: "2026-01-03",
      to: "2026-02-06",
      days: 34,
      owing: true,
    });
  });

  it("times a settle-up from the entry that made it necessary", () => {
    const stats = computeMemberStats(
      input({
        participantId: "ines",
        facts: [
          entry({
            expenseDate: "2026-02-06",
            createdAt: new Date("2026-02-06T07:00:00Z"),
            payers: [{ participantId: "nora", amount: 1000n }],
            shares: [{ participantId: "ines", amount: 1000n }],
          }),
        ],
        settlements: [
          settlement({
            fromParticipantId: "ines",
            toParticipantId: "nora",
            createdAt: new Date("2026-02-06T09:00:00Z"),
          }),
        ],
      }),
    );

    expect(stats.records[0].fastestSettle).toEqual({
      hours: 2,
      on: "2026-02-06",
    });
  });

  it("finds the quietest month, counting the ones they logged nothing in", () => {
    const stats = computeMemberStats(
      input({
        facts: [
          split(3000n, { expenseDate: "2026-01-10" }),
          split(3000n, { expenseDate: "2026-01-20" }),
          split(3000n, { expenseDate: "2026-03-05" }),
        ],
      }),
    );

    expect(stats.records[0].quietestMonth).toEqual({
      month: "2026-02-01",
      entryCount: 0,
      amount: 0n,
    });
  });

  it("keeps records per currency", () => {
    const stats = computeMemberStats(
      input({
        facts: [
          split(9000n, { description: "Sofa" }),
          split(6000n, { currency: "CHF", description: "Skis" }),
        ],
      }),
    );

    expect(stats.records.map((record) => record.currency)).toEqual([
      "EUR",
      "CHF",
    ]);
    expect(stats.records[1].biggestBill?.description).toBe("Skis");
  });
});

describe("a member with nothing to report", () => {
  it("returns three empty ranges rather than nothing at all", () => {
    const stats = computeMemberStats(input({ facts: [] }));

    expect(stats.ranges.map((range) => range.key)).toEqual(["3m", "1y", "all"]);
    expect(stats.ranges.every((range) => range.currencies.length === 0)).toBe(
      true,
    );
    expect(stats.currencies).toEqual([]);
    expect(stats.firstEntry).toBeNull();
    expect(stats.activity.days).toHaveLength(182);
  });
});
