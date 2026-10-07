import { describe, expect, it } from "vitest";
import { changedFields, splitEntriesOf, type ExpenseSnapshot } from "./changes";

/**
 * An edit replaces the whole entry, so which parts of it moved can only be
 * known by comparing it with the entry as it was. The result is what the
 * history prints — "changed the amount", "edited the date and who paid" — so
 * these are held to the two ways it can be wrong: naming something that did
 * not move, and missing something that did.
 *
 * "Did not move" includes what a change of the amount rescales on its own. A
 * line that listed "the amount, who paid and the split" for a figure raised
 * from 84 to 90 was accurate, and said nothing the amount had not.
 */

const ADA = "p-ada";
const BOB = "p-bob";

const dinner: ExpenseSnapshot = {
  description: "Dinner",
  amount: 3000n,
  currency: "EUR",
  direction: "out",
  expenseDate: "2026-10-01",
  category: "restaurants",
  subcategory: null,
  notes: null,
  splitMethod: "equal",
  splitEntries: [{ participantId: ADA }, { participantId: BOB }],
  payers: [{ participantId: ADA, amount: 3000n }],
};

describe("which parts of an expense an edit changed", () => {
  it("says nothing moved for a save that changed nothing", () => {
    expect(changedFields(dinner, { ...dinner })).toEqual([]);
  });

  it("names each field that moved, in the order a reader would list them", () => {
    expect(
      changedFields(dinner, {
        ...dinner,
        notes: "with the cousins",
        description: "Dinner at Luigi's",
        amount: 3600n,
        payers: [{ participantId: ADA, amount: 3600n }],
        expenseDate: "2026-10-02",
      }),
    ).toEqual(["description", "amount", "date", "notes"]);
  });

  it("counts a new currency as a new amount", () => {
    expect(changedFields(dinner, { ...dinner, currency: "CHF" })).toEqual([
      "amount",
    ]);
  });

  it("notices the kind of entry changing", () => {
    expect(changedFields(dinner, { ...dinner, direction: "in" })).toEqual([
      "direction",
    ]);
  });

  it("treats an absent category and an empty one as the same", () => {
    expect(
      changedFields(
        { ...dinner, category: null, notes: null },
        { ...dinner, category: "", notes: "" },
      ),
    ).toEqual([]);
    expect(changedFields(dinner, { ...dinner, subcategory: "fuel" })).toEqual([
      "category",
    ]);
  });
});

describe("a bigger amount, and nothing else", () => {
  it("is the amount alone: the one payer's contribution and an equal split follow the total", () => {
    expect(
      changedFields(dinner, {
        ...dinner,
        amount: 4000n,
        payers: [{ participantId: ADA, amount: 4000n }],
      }),
    ).toEqual(["amount"]);
  });

  it("is the amount alone with several payers whose total moved", () => {
    const two = {
      ...dinner,
      payers: [
        { participantId: ADA, amount: 1000n },
        { participantId: BOB, amount: 2000n },
      ],
    };

    expect(
      changedFields(two, {
        ...two,
        amount: 4000n,
        payers: [
          { participantId: BOB, amount: 2500n },
          { participantId: ADA, amount: 1500n },
        ],
      }),
    ).toEqual(["amount"]);
  });

  it("is the amount alone for percentages and shares, which are their own values", () => {
    const percent = {
      ...dinner,
      splitMethod: "percentage",
      splitEntries: [
        { participantId: ADA, value: "60" },
        { participantId: BOB, value: "40" },
      ],
    };

    expect(
      changedFields(percent, {
        ...percent,
        amount: 4000n,
        payers: [{ participantId: ADA, amount: 4000n }],
      }),
    ).toEqual(["amount"]);
  });

  it("is the amount alone for exact shares, which have to add up to it", () => {
    const exact = {
      ...dinner,
      splitMethod: "exact",
      splitEntries: [
        { participantId: ADA, value: "1000" },
        { participantId: BOB, value: "2000" },
      ],
    };

    expect(
      changedFields(exact, {
        ...exact,
        amount: 4000n,
        payers: [{ participantId: ADA, amount: 4000n }],
        splitEntries: [
          { participantId: ADA, value: "1500" },
          { participantId: BOB, value: "2500" },
        ],
      }),
    ).toEqual(["amount"]);
  });
});

describe("who paid and how it was split", () => {
  it("notices who paid, however the list is ordered", () => {
    expect(
      changedFields(dinner, {
        ...dinner,
        payers: [{ participantId: BOB, amount: 3000n }],
      }),
    ).toEqual(["payers"]);
    expect(
      changedFields(
        {
          ...dinner,
          payers: [
            { participantId: ADA, amount: 1000n },
            { participantId: BOB, amount: 2000n },
          ],
        },
        {
          ...dinner,
          payers: [
            { participantId: BOB, amount: 2000n },
            { participantId: ADA, amount: 1000n },
          ],
        },
      ),
    ).toEqual([]);
  });

  it("notices two payers dividing the same total differently", () => {
    const even = {
      ...dinner,
      payers: [
        { participantId: ADA, amount: 1500n },
        { participantId: BOB, amount: 1500n },
      ],
    };

    expect(
      changedFields(even, {
        ...even,
        payers: [
          { participantId: ADA, amount: 1000n },
          { participantId: BOB, amount: 2000n },
        ],
      }),
    ).toEqual(["payers"]);
  });

  it("notices the split changing method, or who is in it", () => {
    expect(changedFields(dinner, { ...dinner, splitMethod: "exact" })).toEqual([
      "split",
    ]);
    expect(
      changedFields(dinner, {
        ...dinner,
        splitEntries: [{ participantId: ADA }],
      }),
    ).toEqual(["split"]);
  });

  it("notices a percentage moving while the total stays", () => {
    const percent = {
      ...dinner,
      splitMethod: "percentage",
      splitEntries: [
        { participantId: ADA, value: "60" },
        { participantId: BOB, value: "40" },
      ],
    };

    expect(
      changedFields(percent, {
        ...percent,
        splitEntries: [
          { participantId: ADA, value: "50" },
          { participantId: BOB, value: "50" },
        ],
      }),
    ).toEqual(["split"]);
  });

  it("treats an equal split's missing values and empty ones alike", () => {
    expect(
      changedFields(dinner, {
        ...dinner,
        splitEntries: [
          { participantId: BOB, value: "" },
          { participantId: ADA, value: null },
        ],
      }),
    ).toEqual([]);
  });
});

describe("the split as it was stored", () => {
  it("reads the entries back out of the column", () => {
    expect(
      splitEntriesOf({
        method: "percentage",
        entries: [{ participantId: ADA, value: "60" }, { participantId: BOB }],
      }),
    ).toEqual([
      { participantId: ADA, value: "60" },
      { participantId: BOB, value: null },
    ]);
  });

  it("refuses what is not a split, rather than guessing", () => {
    expect(splitEntriesOf(null)).toBeNull();
    expect(splitEntriesOf("equal")).toBeNull();
    expect(splitEntriesOf({ method: "equal" })).toBeNull();
    expect(splitEntriesOf({ entries: [null] })).toBeNull();
    expect(splitEntriesOf({ entries: [{ participantId: 7 }] })).toBeNull();
  });
});
