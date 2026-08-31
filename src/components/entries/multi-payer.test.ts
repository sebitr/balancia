import { describe, expect, it } from "vitest";
import { formatMinorUnits } from "@/components/expenses/expense-form-logic";
import {
  giveRestTo,
  multiPayerContributions,
  splitPaymentEqually,
  summariseMultiPayer,
} from "./multi-payer";

/**
 * Two or more people putting money in.
 *
 * The balance engine refuses an expense whose contributions do not equal its
 * shares, so most of these tests are about naming the shortfall while it can
 * still be fixed rather than sending something that will be thrown out.
 */

const MEMBERS = ["seb", "herve", "cyril"];
const format = (minor: bigint, currency: string) =>
  formatMinorUnits(minor.toString(), currency);

const summarise = (amounts: Record<string, string>, totalMinor = 10000n) =>
  summariseMultiPayer({
    amounts,
    memberIds: MEMBERS,
    currency: "CHF",
    totalMinor,
  });

describe("what the payers add up to", () => {
  it("adds the ones with an amount and ignores the rest", () => {
    const summary = summarise({ seb: "60", herve: "40", cyril: "" });
    expect(summary.paidMinor).toBe(10000n);
    expect(summary.differenceMinor).toBe(0n);
    expect(summary.payerIds).toEqual(["seb", "herve"]);
  });

  it("names a shortfall as positive and an overage as negative", () => {
    expect(summarise({ seb: "60" }).differenceMinor).toBe(4000n);
    expect(summarise({ seb: "60", herve: "60" }).differenceMinor).toBe(-2000n);
  });

  it("treats what somebody is halfway through typing as nothing", () => {
    // Not an error: they have not made a mistake yet.
    expect(summarise({ seb: "1x", herve: "" }).paidMinor).toBe(0n);
    expect(summarise({ seb: "-5" }).paidMinor).toBe(0n);
  });

  it("lists payers in member order, not the order they were typed", () => {
    // "The rest" has to land on the same person for the same screen.
    const summary = summarise({ cyril: "50", seb: "50" });
    expect(summary.payerIds).toEqual(["seb", "cyril"]);
  });
});

describe("what gets sent", () => {
  it("hands back the contributions when they balance", () => {
    expect(
      multiPayerContributions({
        amounts: { seb: "60", herve: "40" },
        memberIds: MEMBERS,
        currency: "CHF",
        totalMinor: 10000n,
      }),
    ).toEqual([
      { participantId: "seb", amount: "6000" },
      { participantId: "herve", amount: "4000" },
    ]);
  });

  it("refuses rather than sending something the engine will throw out", () => {
    const unbalanced: Record<string, string>[] = [
      { seb: "60" },
      { seb: "60", herve: "60" },
      {},
    ];
    for (const amounts of unbalanced) {
      expect(
        multiPayerContributions({
          amounts,
          memberIds: MEMBERS,
          currency: "CHF",
          totalMinor: 10000n,
        }),
      ).toBeNull();
    }
  });
});

describe("splitting the payment equally", () => {
  it("divides it and gives the odd cent to the first", () => {
    expect(
      splitPaymentEqually({
        payerIds: ["seb", "herve", "cyril"],
        currency: "CHF",
        totalMinor: 10000n,
        format,
      }),
    ).toEqual({ seb: "33.34", herve: "33.33", cyril: "33.33" });
  });

  it("adds up to the total whoever it is divided between", () => {
    const amounts = splitPaymentEqually({
      payerIds: ["seb", "herve", "cyril"],
      currency: "CHF",
      totalMinor: 10000n,
      format,
    });
    expect(summarise(amounts).differenceMinor).toBe(0n);
  });

  it("says nothing when there is nobody or nothing to divide", () => {
    expect(
      splitPaymentEqually({
        payerIds: [],
        currency: "CHF",
        totalMinor: 10000n,
        format,
      }),
    ).toEqual({});
    expect(
      splitPaymentEqually({
        payerIds: MEMBERS,
        currency: "CHF",
        totalMinor: 0n,
        format,
      }),
    ).toEqual({});
  });
});

describe("giving the rest to somebody", () => {
  it("hands them exactly what is missing", () => {
    const next = giveRestTo({
      amounts: { seb: "60" },
      participantId: "herve",
      memberIds: MEMBERS,
      currency: "CHF",
      totalMinor: 10000n,
      format,
    });
    expect(next.herve).toBe("40.00");
    expect(summarise(next).differenceMinor).toBe(0n);
  });

  it("replaces what they had rather than adding to it", () => {
    const next = giveRestTo({
      amounts: { seb: "60", herve: "5" },
      participantId: "herve",
      memberIds: MEMBERS,
      currency: "CHF",
      totalMinor: 10000n,
      format,
    });
    expect(next.herve).toBe("40.00");
  });

  it("gives them nothing when the others have already overpaid", () => {
    // No amount this person can hold fixes an overage, and the warning line
    // keeps saying so.
    const next = giveRestTo({
      amounts: { seb: "60", cyril: "60" },
      participantId: "herve",
      memberIds: MEMBERS,
      currency: "CHF",
      totalMinor: 10000n,
      format,
    });
    expect(next.herve).toBe("0.00");
    expect(summarise(next).differenceMinor).toBe(-2000n);
  });
});
