import { describe, expect, it } from "vitest";
import { impactOf, stakeOf, type EntryParties } from "./stake";

/**
 * What one entry did to each person in it, read from its payers and shares.
 *
 * The detail screen words these; the cases are here so the arithmetic under
 * the words is pinned down on its own — in particular the multi-payer entries
 * and income, where "who paid" and "which way the money goes" stop being the
 * same question.
 */

const party = (
  participantId: string,
  amount: bigint,
  name = participantId,
) => ({
  participantId,
  displayName: name,
  amount,
});

/** Ada pays €90.00 for the three of them. */
const DINNER: EntryParties = {
  direction: "out",
  payers: [party("ada", 9000n, "Ada")],
  shares: [
    party("ada", 3000n, "Ada"),
    party("bob", 3000n, "Bob"),
    party("chloe", 3000n, "Chloé"),
  ],
};

/** Ada and Bob both paid towards it; Chloé did not. */
const SHARED_BILL: EntryParties = {
  direction: "out",
  payers: [party("ada", 7000n, "Ada"), party("bob", 2000n, "Bob")],
  shares: DINNER.shares,
};

/** Ada was handed a €90.00 refund that belongs to all three. */
const REFUND: EntryParties = {
  direction: "in",
  payers: [party("ada", 9000n, "Ada")],
  shares: DINNER.shares,
};

describe("impactOf", () => {
  it("credits the payer with everything they paid beyond their own share", () => {
    expect(impactOf(DINNER, "ada")).toBe(6000n);
    expect(impactOf(DINNER, "bob")).toBe(-3000n);
  });

  it("runs income backwards: whoever received the money owes the others", () => {
    expect(impactOf(REFUND, "ada")).toBe(-6000n);
    expect(impactOf(REFUND, "bob")).toBe(3000n);
  });

  it("is nothing for someone the entry does not name", () => {
    expect(impactOf(DINNER, "dan")).toBe(0n);
  });
});

describe("stakeOf", () => {
  it("reads the payer who is owed as having paid, and getting money back", () => {
    expect(stakeOf(DINNER, "ada")).toEqual({
      kind: "paid",
      paid: 9000n,
      net: 6000n,
    });
  });

  it("reads somebody with a share as owing whoever paid", () => {
    expect(stakeOf(DINNER, "bob")).toEqual({
      kind: "other",
      payers: ["Ada"],
      net: -3000n,
    });
  });

  it("names every payer when the reader was not one of them", () => {
    expect(stakeOf(SHARED_BILL, "chloe")).toEqual({
      kind: "other",
      payers: ["Ada", "Bob"],
      net: -3000n,
    });
  });

  it("lets a part-payer still owe something", () => {
    expect(stakeOf(SHARED_BILL, "bob")).toEqual({
      kind: "paid",
      paid: 2000n,
      net: -1000n,
    });
  });

  it("says when somebody paid exactly their own share", () => {
    const evenly: EntryParties = {
      ...SHARED_BILL,
      payers: [party("ada", 6000n, "Ada"), party("bob", 3000n, "Bob")],
    };
    expect(stakeOf(evenly, "bob")).toEqual({
      kind: "paid",
      paid: 3000n,
      net: 0n,
    });
  });

  it("does not count a payer down for nothing as somebody who paid", () => {
    const leftover: EntryParties = {
      ...DINNER,
      payers: [party("ada", 9000n, "Ada"), party("bob", 0n, "Bob")],
    };
    expect(stakeOf(leftover, "bob")).toEqual({
      kind: "other",
      payers: ["Ada"],
      net: -3000n,
    });
  });

  it("reads income the right way round for whoever received it", () => {
    expect(stakeOf(REFUND, "ada")).toEqual({
      kind: "paid",
      paid: 9000n,
      net: -6000n,
    });
    expect(stakeOf(REFUND, "bob")).toEqual({
      kind: "other",
      payers: ["Ada"],
      net: 3000n,
    });
  });

  it("has nothing to say to somebody outside the entry", () => {
    expect(stakeOf(DINNER, "dan")).toEqual({ kind: "none" });
  });

  it("has nothing to say to a member with no place in the money", () => {
    expect(stakeOf(DINNER, null)).toEqual({ kind: "none" });
  });
});
