import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { SETTLED_SENTENCE, savedSummary } from "./saved-summary";

/**
 * The line under "Repayment recorded".
 *
 * It read "€30.00 · Sam → Robin Audit" to Robin Audit: their own name, in
 * the third person, on the far side of an arrow that did not say which way
 * round it was meant. It is a sentence from the reader's side now.
 */

const PAIR = {
  fromParticipantId: "sam",
  fromName: "Sam",
  toParticipantId: "robin",
  toName: "Robin Audit",
  method: "",
};

function settled(selfId: string) {
  return savedSummary({
    type: "settle",
    amount: "€30.00",
    payerName: "Sam",
    participantCount: 2,
    selfId,
    settlement: PAIR,
  });
}

/** The message a side selects, rendered as the toast renders it. */
function say(
  catalogue: typeof en,
  locale: string,
  side: keyof typeof SETTLED_SENTENCE,
): string {
  return new IntlMessageFormat(
    catalogue.addEntry.saved[SETTLED_SENTENCE[side]],
    locale,
  ).format({ from: PAIR.fromName, to: PAIR.toName }) as string;
}

describe("savedSummary for a repayment", () => {
  it("says the reader was paid back when they received it", () => {
    const summary = settled("robin");

    expect(summary.settlement?.side).toBe("received");
    expect(say(en, "en", "received")).toBe("Sam paid you back");
    expect(say(fr as unknown as typeof en, "fr", "received")).toBe(
      "Sam t’a remboursé",
    );
  });

  it("says the reader paid when they did", () => {
    const summary = settled("sam");

    expect(summary.settlement?.side).toBe("paid");
    expect(say(en, "en", "paid")).toBe("You paid Robin Audit back");
    expect(say(fr as unknown as typeof en, "fr", "paid")).toBe(
      "Tu as remboursé Robin Audit",
    );
  });

  it("names both people when the reader is neither", () => {
    const summary = settled("grace");

    expect(summary.settlement?.side).toBe("between");
    expect(say(en, "en", "between")).toBe("Sam paid Robin Audit back");
  });

  it("draws no arrow in any of them", () => {
    for (const side of ["paid", "received", "between"] as const) {
      expect(say(en, "en", side)).not.toContain("→");
    }
  });

  it("keeps the method it was paid by", () => {
    const summary = savedSummary({
      type: "settle",
      amount: "€30.00",
      payerName: "Sam",
      participantCount: 2,
      selfId: "robin",
      settlement: { ...PAIR, method: "TWINT" },
    });

    expect(summary.settlement?.method).toBe("TWINT");
  });
});
