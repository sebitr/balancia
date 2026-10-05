import { describe, expect, it } from "vitest";
import {
  giveRemaining,
  hasNoShare,
  remainingCandidate,
  stepShare,
} from "./split-shortcuts";

const THREE = ["seb", "herve", "cyril"];

describe("remainingCandidate", () => {
  const candidate = (
    values: Record<string, string>,
    edited: readonly string[] = [],
  ) =>
    remainingCandidate({
      participantIds: THREE,
      values,
      edited: new Set(edited),
      currency: "EUR",
    });

  /**
   * The audit's case: €90 seeded as 30 / 30 / 30, Seb typed 25. The ones
   * still on their seeded figure are the ones whose share is "what is left".
   */
  it("is the last person the reader has not touched", () => {
    expect(candidate({ seb: "25", herve: "30", cyril: "30" }, ["seb"])).toBe(
      "cyril",
    );
    expect(
      candidate({ seb: "25", herve: "30", cyril: "30" }, ["seb", "cyril"]),
    ).toBe("herve");
  });

  it("is the first one at zero once every field has been touched", () => {
    expect(
      candidate({ seb: "50", herve: "", cyril: "30" }, THREE),
    ).toBe("herve");
    expect(
      candidate({ seb: "50", herve: "0.00", cyril: "" }, THREE),
    ).toBe("herve");
  });

  it("falls back to the last person, as a guess one tap undoes", () => {
    expect(
      candidate({ seb: "25", herve: "30", cyril: "30" }, THREE),
    ).toBe("cyril");
  });

  it("is nobody when there is nobody in the split", () => {
    expect(
      remainingCandidate({
        participantIds: [],
        values: {},
        edited: new Set(),
        currency: "EUR",
      }),
    ).toBeNull();
  });
});

describe("giveRemaining", () => {
  it("adds the shortfall to the one person, and leaves the rest alone", () => {
    expect(
      giveRemaining({
        values: { seb: "25", herve: "30", cyril: "30" },
        participantId: "cyril",
        participantIds: THREE,
        currency: "EUR",
        totalMinor: 9000n,
      }),
    ).toEqual({ seb: "25", herve: "30", cyril: "35.00" });
  });

  it("reads the other fields the way the note does", () => {
    expect(
      giveRemaining({
        values: { seb: "12,50", herve: "", cyril: "30." },
        participantId: "herve",
        participantIds: THREE,
        currency: "EUR",
        totalMinor: 9000n,
      }).herve,
    ).toBe("47.50");
  });

  it("ignores the values of people who are not in the split", () => {
    expect(
      giveRemaining({
        values: { seb: "40", herve: "", cyril: "99" },
        participantId: "herve",
        participantIds: ["seb", "herve"],
        currency: "EUR",
        totalMinor: 9000n,
      }),
    ).toEqual({ seb: "40", herve: "50.00", cyril: "99" });
  });
});

describe("stepShare", () => {
  it("adds and takes away one share", () => {
    expect(stepShare("1", 1)).toBe("2");
    expect(stepShare("2", -1)).toBe("1");
  });

  it("keeps a fraction", () => {
    expect(stepShare("1.5", 1)).toBe("2.5");
    expect(stepShare("1,5", -1)).toBe("0.5");
  });

  it("never goes below none", () => {
    expect(stepShare("0", -1)).toBe("0");
    expect(stepShare("0.5", -1)).toBe("0");
  });

  it("starts an empty or unreadable field from nothing", () => {
    expect(stepShare("", 1)).toBe("1");
    expect(stepShare(undefined, 1)).toBe("1");
    expect(stepShare("lots", 1)).toBe("1");
  });
});

describe("hasNoShare", () => {
  it("is true only when there is nothing left to take away", () => {
    expect(hasNoShare("0")).toBe(true);
    expect(hasNoShare("")).toBe(true);
    expect(hasNoShare("0.5")).toBe(false);
    expect(hasNoShare("1")).toBe(false);
  });
});
