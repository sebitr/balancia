import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  assignReceipt,
  buildReceiptSplit,
  ReceiptAssignmentError,
  toSplitInput,
  type AssignmentInput,
} from "./assignment";
import type { ReceiptItem } from "./types";

/**
 * The accounting tests.
 *
 * One property matters more than every example here: whatever is assigned to
 * whom, and however the shared charges are spread, the shares must add up to
 * the expense total exactly. A split that is one rappen short is not a rounding
 * detail — it is a balance that never settles.
 */

const SEB = "p-seb";
const ALEX = "p-alex";
const JULIE = "p-julie";
const EVERYONE = [SEB, ALEX, JULIE];

function item(id: string, total: bigint, name = id): ReceiptItem {
  return { id, name, total };
}

/** The worked example from the product brief. */
const DINNER: readonly ReceiptItem[] = [
  item("i1", 1900n, "Margherita"),
  item("i2", 2450n, "Carbonara"),
  item("i3", 1400n, "Beer x2"),
  item("i4", 950n, "Tiramisu"),
];

const DINNER_ASSIGNMENT = [
  { itemId: "i1", participantIds: [SEB] },
  { itemId: "i2", participantIds: [ALEX] },
  { itemId: "i3", participantIds: [SEB, ALEX] },
  { itemId: "i4", participantIds: [JULIE] },
];

function sum(shares: readonly { amount: bigint }[]): bigint {
  return shares.reduce((total, share) => total + share.amount, 0n);
}

describe("assignReceipt", () => {
  it("gives each person their own items", () => {
    const result = assignReceipt({
      items: DINNER,
      assignments: DINNER_ASSIGNMENT,
      participantIds: EVERYONE,
      total: 6700n,
      strategy: "proportional",
    });

    // Seb: 19.00 + half the beer. Alex: 24.50 + half the beer. Julie: 9.50.
    expect(result.shares.map((share) => share.items)).toEqual([
      2600n,
      3150n,
      950n,
    ]);
  });

  it("splits a shared item equally between the people who had it", () => {
    const result = assignReceipt({
      items: [item("i1", 1400n)],
      assignments: [{ itemId: "i1", participantIds: [SEB, ALEX] }],
      participantIds: EVERYONE,
      total: 1400n,
      strategy: "proportional",
    });
    expect(result.shares[0].items).toBe(700n);
    expect(result.shares[1].items).toBe(700n);
  });

  it("gives the odd minor unit of a shared item to the earlier participant", () => {
    const result = assignReceipt({
      items: [item("i1", 501n)],
      assignments: [{ itemId: "i1", participantIds: [ALEX, SEB] }],
      participantIds: EVERYONE,
      total: 501n,
      strategy: "proportional",
    });
    // Group order decides, not the order the checkboxes were ticked.
    expect(result.shares[0].items).toBe(251n);
    expect(result.shares[1].items).toBe(250n);
  });

  describe("shared charges", () => {
    const input: AssignmentInput = {
      items: DINNER,
      assignments: DINNER_ASSIGNMENT,
      participantIds: EVERYONE,
      total: 7210n, // 67.00 of items plus 5.10 of tax
      strategy: "proportional",
    };

    it("treats everything above the items as shared", () => {
      const result = assignReceipt(input);
      expect(result.sharedCharges).toBe(510n);
    });

    it("spreads shared charges in proportion to what each person had", () => {
      const result = assignReceipt(input);
      // 26.00 : 31.50 : 9.50 of 5.10 → 1.98 : 2.40 : 0.72
      expect(result.shares.map((share) => share.shared)).toEqual([
        198n,
        240n,
        72n,
      ]);
      expect(sum(result.shares)).toBe(7210n);
    });

    it("spreads them equally when asked to", () => {
      const result = assignReceipt({ ...input, strategy: "equal" });
      expect(result.shares.map((share) => share.shared)).toEqual([
        170n,
        170n,
        170n,
      ]);
      expect(sum(result.shares)).toBe(7210n);
    });

    it("falls back to equal when nothing has been assigned yet", () => {
      const result = assignReceipt({
        ...input,
        assignments: [],
        strategy: "proportional",
      });
      expect(result.unassignedItemIds).toHaveLength(4);
      expect(result.shares.map((share) => share.amount)).toEqual([
        2404n,
        2403n,
        2403n,
      ]);
      expect(sum(result.shares)).toBe(7210n);
    });

    it("distributes an unclaimed item rather than dropping it", () => {
      const result = assignReceipt({
        ...input,
        assignments: DINNER_ASSIGNMENT.slice(0, 3),
      });
      expect(result.unassignedItemIds).toEqual(["i4"]);
      // The tiramisu nobody claimed rides along with the tax.
      expect(result.sharedCharges).toBe(510n + 950n);
      expect(sum(result.shares)).toBe(7210n);
    });

    it("handles a total below the items, as a missed discount would", () => {
      const result = assignReceipt({ ...input, total: 6000n });
      expect(result.sharedCharges).toBe(-700n);
      expect(sum(result.shares)).toBe(6000n);
    });
  });

  it("ignores participants who are not in the split", () => {
    const result = assignReceipt({
      items: [item("i1", 1000n)],
      assignments: [{ itemId: "i1", participantIds: [SEB, "p-stranger"] }],
      participantIds: [SEB, ALEX],
      total: 1000n,
      strategy: "proportional",
    });
    expect(result.shares[0].amount).toBe(1000n);
    expect(result.shares[1].amount).toBe(0n);
  });

  it("counts a participant listed twice on one item only once", () => {
    const result = assignReceipt({
      items: [item("i1", 1000n)],
      assignments: [{ itemId: "i1", participantIds: [SEB, SEB, ALEX] }],
      participantIds: [SEB, ALEX],
      total: 1000n,
      strategy: "proportional",
    });
    expect(result.shares.map((share) => share.amount)).toEqual([500n, 500n]);
  });

  it("refuses a split with nobody in it", () => {
    expect(() =>
      assignReceipt({
        items: [],
        assignments: [],
        participantIds: [],
        total: 100n,
        strategy: "equal",
      }),
    ).toThrow(ReceiptAssignmentError);
  });
});

describe("toSplitInput", () => {
  it("produces an exact split", () => {
    const { shares } = assignReceipt({
      items: DINNER,
      assignments: DINNER_ASSIGNMENT,
      participantIds: EVERYONE,
      total: 7210n,
      strategy: "proportional",
    });
    const input = toSplitInput(shares);
    expect(input.method).toBe("exact");
    expect(input.entries).toHaveLength(3);
  });

  it("leaves out people who owe nothing", () => {
    const { shares } = assignReceipt({
      items: [item("i1", 1000n)],
      assignments: [{ itemId: "i1", participantIds: [SEB] }],
      participantIds: EVERYONE,
      total: 1000n,
      strategy: "proportional",
    });
    expect(toSplitInput(shares).entries.map((e) => e.participantId)).toEqual([
      SEB,
    ]);
  });

  it("keeps everyone when the whole receipt is zero", () => {
    const { shares } = assignReceipt({
      items: [],
      assignments: [],
      participantIds: EVERYONE,
      total: 0n,
      strategy: "equal",
    });
    expect(toSplitInput(shares).entries).toHaveLength(3);
  });
});

describe("buildReceiptSplit", () => {
  it("produces a canonical split the expense engine accepts", () => {
    const { split, assignment } = buildReceiptSplit({
      items: DINNER,
      assignments: DINNER_ASSIGNMENT,
      participantIds: EVERYONE,
      total: 7210n,
      strategy: "proportional",
    });

    expect(split.method).toBe("exact");
    expect(
      split.allocations.reduce((total, entry) => total + entry.amount, 0n),
    ).toBe(7210n);
    expect(split.allocations.map((entry) => entry.amount)).toEqual(
      assignment.shares.map((share) => share.amount),
    );
  });

  it("carries the worked example from the brief through to allocations", () => {
    const { split } = buildReceiptSplit({
      items: DINNER,
      assignments: DINNER_ASSIGNMENT,
      participantIds: EVERYONE,
      total: 6700n,
      strategy: "proportional",
    });
    expect(split.allocations).toEqual([
      { participantId: SEB, amount: 2600n },
      { participantId: ALEX, amount: 3150n },
      { participantId: JULIE, amount: 950n },
    ]);
  });
});

describe("the sum invariant", () => {
  it("holds for any assignment, strategy and total", () => {
    const participantIds = EVERYONE;

    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 500_000n }), {
          minLength: 0,
          maxLength: 12,
        }),
        fc.array(fc.array(fc.integer({ min: 0, max: 2 }), { maxLength: 3 }), {
          maxLength: 12,
        }),
        fc.bigInt({ min: -50_000n, max: 5_000_000n }),
        fc.constantFrom("proportional" as const, "equal" as const),
        (totals, claims, total, strategy) => {
          const items = totals.map((value, index) => item(`i${index}`, value));
          const assignments = items.map((entry, index) => ({
            itemId: entry.id,
            participantIds: (claims[index] ?? []).map(
              (position) => participantIds[position],
            ),
          }));

          const result = assignReceipt({
            items,
            assignments,
            participantIds,
            total,
            strategy,
          });

          // 1. Every minor unit is accounted for, and none is invented.
          expect(sum(result.shares)).toBe(total);
          // 2. Each person's parts add up to their share.
          for (const share of result.shares) {
            expect(share.items + share.shared).toBe(share.amount);
          }
          // 3. The canonical engine agrees, which is what actually gets stored.
          const split = buildReceiptSplit({
            items,
            assignments,
            participantIds,
            total,
            strategy,
          }).split;
          expect(
            split.allocations.reduce((acc, entry) => acc + entry.amount, 0n),
          ).toBe(total);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is deterministic", () => {
    const input: AssignmentInput = {
      items: DINNER,
      assignments: DINNER_ASSIGNMENT,
      participantIds: EVERYONE,
      total: 7213n,
      strategy: "proportional",
    };
    expect(assignReceipt(input)).toEqual(assignReceipt(input));
  });
});
