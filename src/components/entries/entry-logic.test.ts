import { describe, expect, it } from "vitest";
import {
  confirmationKey,
  directionOf,
  hasAmount,
  pressKey,
  primaryActionKey,
  resetsForType,
  summariseSplit,
  type KeypadKey,
} from "./entry-logic";

/** Types a whole string through the pad, one key at a time. */
const type = (keys: string, currency = "CHF"): string =>
  [...keys].reduce(
    (text, key) => pressKey(text, key as KeypadKey, currency),
    "",
  );

describe("pressKey", () => {
  it("builds an amount digit by digit", () => {
    expect(type("8460")).toBe("8460");
    expect(type("84.60")).toBe("84.60");
  });

  it("turns a leading point into an explicit zero", () => {
    expect(type(".5")).toBe("0.5");
  });

  it("refuses a second decimal point", () => {
    expect(type("1.2.3")).toBe("1.23");
  });

  it("stops at the currency's precision", () => {
    expect(type("1.234")).toBe("1.23");
  });

  /**
   * The prototype hardcodes two decimals. Yen has none, and a form that lets
   * someone type ¥1200.50 only fails once the server sees it.
   */
  it("gives a currency with no minor unit no decimal point at all", () => {
    expect(type("1200.50", "JPY")).toBe("120050");
    expect(pressKey("1200", ".", "JPY")).toBe("1200");
  });

  it("allows the third decimal a currency actually has", () => {
    expect(type("1.234", "BHD")).toBe("1.234");
    expect(type("1.2345", "BHD")).toBe("1.234");
  });

  it("caps the whole part", () => {
    expect(type("1234567890")).toBe("12345678");
  });

  it("still allows decimals once the whole part is full", () => {
    expect(type("12345678.90")).toBe("12345678.90");
  });

  it("replaces a lone leading zero rather than growing it", () => {
    expect(type("05")).toBe("5");
    expect(type("0.5")).toBe("0.5");
  });

  it("deletes from the end, and does nothing when empty", () => {
    expect(pressKey("84.60", "delete", "CHF")).toBe("84.6");
    expect(pressKey("8", "delete", "CHF")).toBe("");
    expect(pressKey("", "delete", "CHF")).toBe("");
  });
});

describe("hasAmount", () => {
  it("is false for empty, zero and punctuation alone", () => {
    expect(hasAmount("")).toBe(false);
    expect(hasAmount("0")).toBe(false);
    expect(hasAmount("0.00")).toBe(false);
    expect(hasAmount(".")).toBe(false);
  });

  it("is true as soon as there is something to save", () => {
    expect(hasAmount("0.01")).toBe(true);
    expect(hasAmount("84.60")).toBe(true);
  });
});

describe("summariseSplit", () => {
  it("leads with what each person carries on an equal split", () => {
    expect(
      summariseSplit({
        method: "equal",
        participantCount: 3,
        eachFormatted: "28.20",
      }),
    ).toEqual({ key: "equalEach", params: { count: 3, amount: "28.20" } });
  });

  it("names the method on the others", () => {
    expect(summariseSplit({ method: "exact", participantCount: 3 }).key).toBe(
      "exactAmounts",
    );
    expect(
      summariseSplit({ method: "percentage", participantCount: 3 }).key,
    ).toBe("percentages");
    expect(summariseSplit({ method: "shares", participantCount: 3 }).key).toBe(
      "shares",
    );
  });

  it("says so when the split came from the receipt", () => {
    expect(
      summariseSplit({ method: "exact", participantCount: 3, byItem: true })
        .key,
    ).toBe("byItem");
  });

  /** "Mine only" income, and any entry that covers one person. */
  it("does not talk about splitting when there is nobody to split with", () => {
    expect(summariseSplit({ method: "equal", participantCount: 1 }).key).toBe(
      "justOne",
    );
  });
});

describe("directionOf", () => {
  it("maps the two entry types that reach the ledger", () => {
    expect(directionOf("expense")).toBe("out");
    expect(directionOf("income")).toBe("in");
  });

  it("gives a settlement no direction — it is neither", () => {
    expect(directionOf("settle")).toBeNull();
  });
});

describe("primaryActionKey", () => {
  it("changes with the type and with recurrence", () => {
    expect(primaryActionKey("expense", false)).toBe("addExpense");
    expect(primaryActionKey("expense", true)).toBe("saveRecurringExpense");
    expect(primaryActionKey("income", false)).toBe("addIncome");
    expect(primaryActionKey("income", true)).toBe("saveRecurringIncome");
  });

  it("ignores recurrence on a settlement, which cannot repeat", () => {
    expect(primaryActionKey("settle", false)).toBe("recordPayment");
    expect(primaryActionKey("settle", true)).toBe("recordPayment");
  });
});

describe("confirmationKey", () => {
  it("matches what was actually saved", () => {
    expect(confirmationKey("expense", false)).toBe("expenseAdded");
    expect(confirmationKey("income", false)).toBe("incomeAdded");
    expect(confirmationKey("expense", true)).toBe("recurringSaved");
    expect(confirmationKey("income", true)).toBe("recurringSaved");
    expect(confirmationKey("settle", false)).toBe("paymentRecorded");
  });
});

describe("resetsForType", () => {
  it("keeps a scan only on an expense", () => {
    expect(resetsForType("expense").clearScan).toBe(false);
    expect(resetsForType("income").clearScan).toBe(true);
    expect(resetsForType("settle").clearScan).toBe(true);
  });

  /** A repayment is one movement, in the group's own currency, with no paperwork. */
  it("strips recurrence, files and currency choice from a settlement only", () => {
    expect(resetsForType("settle")).toEqual({
      clearScan: true,
      clearRecurrence: true,
      clearAttachments: true,
      resetCurrency: true,
    });
    expect(resetsForType("income").clearRecurrence).toBe(false);
    expect(resetsForType("income").clearAttachments).toBe(false);
    expect(resetsForType("income").resetCurrency).toBe(false);
  });
});
