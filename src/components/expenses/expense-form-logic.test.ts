import { describe, expect, it } from "vitest";
import {
  formatMinorUnits,
  parseAmountToMinor,
  previewSplit,
  splitValuesToText,
  suggestExactValues,
  suggestPercentages,
} from "./expense-form-logic";

describe("parseAmountToMinor", () => {
  it("parses amounts for two-decimal currencies", () => {
    expect(parseAmountToMinor("10.50", "EUR")).toEqual({
      ok: true,
      value: 1050n,
    });
    expect(parseAmountToMinor(" 7 ", "EUR")).toEqual({ ok: true, value: 700n });
  });

  it("parses zero-decimal and three-decimal currencies", () => {
    expect(parseAmountToMinor("1500", "JPY")).toEqual({
      ok: true,
      value: 1500n,
    });
    expect(parseAmountToMinor("1.005", "BHD")).toEqual({
      ok: true,
      value: 1005n,
    });
  });

  it("reports a helpful error for too much precision", () => {
    const result = parseAmountToMinor("10.505", "EUR");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toEqual({
      key: "amountTooPrecise",
      params: { currency: "EUR", places: 2 },
    });
  });

  it("rejects empty, negative and non-numeric input with distinct reasons", () => {
    const reasonFor = (input: string) => {
      const result = parseAmountToMinor(input, "EUR");
      return result.ok ? null : result.error.key;
    };
    expect(reasonFor("")).toBe("amountRequired");
    expect(reasonFor("-5")).toBe("amountNegative");
    expect(reasonFor("abc")).toBe("amountNotDecimal");
  });
});

describe("formatMinorUnits", () => {
  it("renders stored minor units for editing", () => {
    expect(formatMinorUnits("1050", "EUR")).toBe("10.50");
    expect(formatMinorUnits("1500", "JPY")).toBe("1500");
    expect(formatMinorUnits("1005", "BHD")).toBe("1.005");
  });
});

describe("splitValuesToText", () => {
  const exact = [
    { participantId: "a", value: "83333" },
    { participantId: "b", value: "83333" },
    { participantId: "c", value: "83334" },
  ];

  it("turns stored exact amounts back into major units", () => {
    expect(splitValuesToText("exact", exact, "CHF")).toEqual({
      a: "833.33",
      b: "833.33",
      c: "833.34",
    });
  });

  it("round-trips through the parser the form submits with", () => {
    const text = splitValuesToText("exact", exact, "CHF");
    for (const entry of exact) {
      expect(parseAmountToMinor(text[entry.participantId], "CHF")).toEqual({
        ok: true,
        value: BigInt(entry.value),
      });
    }
  });

  it("leaves shares and percentages as they were typed", () => {
    const entries = [
      { participantId: "a", value: "2" },
      { participantId: "b", value: "33.33" },
    ];
    expect(splitValuesToText("shares", entries, "CHF")).toEqual({
      a: "2",
      b: "33.33",
    });
    expect(splitValuesToText("percentage", entries, "CHF")).toEqual({
      a: "2",
      b: "33.33",
    });
  });

  it("gives an equal split the empty object a new one starts with", () => {
    expect(splitValuesToText("equal", [{ participantId: "a" }], "CHF")).toEqual(
      {},
    );
  });
});

describe("previewSplit", () => {
  const participants = ["a", "b", "c"];

  it("previews an equal split and flags the rounding difference", () => {
    const preview = previewSplit({
      totalMinor: 1000n,
      currency: "EUR",
      method: "equal",
      participantIds: participants,
      values: {},
    });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.allocations.map((a) => a.amount)).toEqual([
      334n,
      333n,
      333n,
    ]);
    expect(preview.roundingNote).toEqual({
      key: "roundingNote",
      params: { count: 1, amount: expect.stringContaining("0.01") },
    });
  });

  it("reports no rounding note when the split is exact", () => {
    const preview = previewSplit({
      totalMinor: 900n,
      currency: "EUR",
      method: "equal",
      participantIds: participants,
      values: {},
    });
    expect(preview.ok && preview.roundingNote).toBeNull();
  });

  it("validates percentages against 100", () => {
    const bad = previewSplit({
      totalMinor: 1000n,
      currency: "EUR",
      method: "percentage",
      participantIds: ["a", "b"],
      values: { a: "50", b: "49" },
    });
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.error?.key).toBe("percentageSumMismatch");

    const good = previewSplit({
      totalMinor: 1000n,
      currency: "EUR",
      method: "percentage",
      participantIds: ["a", "b"],
      values: { a: "50", b: "50" },
    });
    expect(good.ok).toBe(true);
  });

  it("validates exact amounts against the total", () => {
    const bad = previewSplit({
      totalMinor: 1000n,
      currency: "EUR",
      method: "exact",
      participantIds: ["a", "b"],
      values: { a: "6.00", b: "3.00" },
    });
    expect(bad.ok).toBe(false);

    const good = previewSplit({
      totalMinor: 1000n,
      currency: "EUR",
      method: "exact",
      participantIds: ["a", "b"],
      values: { a: "6.00", b: "4.00" },
    });
    expect(good.ok).toBe(true);
    expect(good.ok && good.allocations.map((a) => a.amount)).toEqual([
      600n,
      400n,
    ]);
  });

  it("previews weighted shares", () => {
    const preview = previewSplit({
      totalMinor: 10000n,
      currency: "EUR",
      method: "shares",
      participantIds: ["a", "b", "c"],
      values: { a: "2", b: "1", c: "1" },
    });
    expect(preview.ok && preview.allocations.map((a) => a.amount)).toEqual([
      5000n,
      2500n,
      2500n,
    ]);
  });

  it("asks for at least one person", () => {
    const preview = previewSplit({
      totalMinor: 1000n,
      currency: "EUR",
      method: "equal",
      participantIds: [],
      values: {},
    });
    expect(preview.ok).toBe(false);
    expect(preview.ok === false && preview.error?.key).toBe(
      "participantsRequired",
    );
  });

  it("stays quiet before an amount has been typed", () => {
    const preview = previewSplit({
      totalMinor: null,
      currency: "EUR",
      method: "equal",
      participantIds: ["a"],
      values: {},
    });
    expect(preview.ok).toBe(false);
    expect(preview.ok === false && preview.error).toBeNull();
  });

  it("formats allocations in the expense currency and the given locale", () => {
    const input = {
      totalMinor: 3000n,
      currency: "JPY",
      method: "equal" as const,
      participantIds: ["a", "b"],
      values: {},
    };

    const english = previewSplit({ ...input, locale: "en-US" });
    expect(english.ok && english.allocations[0].formatted).toContain("1,500");

    // French groups digits with a narrow no-break space and trails the symbol.
    const french = previewSplit({ ...input, locale: "fr-FR" });
    expect(french.ok && french.allocations[0].formatted).toMatch(/1\s500/u);
  });
});

describe("suggestions", () => {
  it("pre-fills exact amounts that already add up", () => {
    const values = suggestExactValues(1000n, "EUR", ["a", "b", "c"]);
    expect(Object.values(values)).toEqual(["3.34", "3.33", "3.33"]);
  });

  it("pre-fills percentages that total exactly 100", () => {
    const values = suggestPercentages(["a", "b", "c"]);
    const total = Object.values(values).reduce(
      (sum, value) => sum + Number(value),
      0,
    );
    expect(total).toBeCloseTo(100, 10);
    expect(values.a).toBe("33.34");
  });
});
