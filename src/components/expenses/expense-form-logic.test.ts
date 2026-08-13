import { describe, expect, it } from "vitest";
import {
  formatMinorUnits,
  parseAmountToMinor,
  previewSplit,
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
    expect(result.ok === false && result.error).toMatch(/decimal place/);
  });

  it("rejects empty, negative and non-numeric input", () => {
    expect(parseAmountToMinor("", "EUR").ok).toBe(false);
    expect(parseAmountToMinor("-5", "EUR").ok).toBe(false);
    expect(parseAmountToMinor("abc", "EUR").ok).toBe(false);
  });
});

describe("formatMinorUnits", () => {
  it("renders stored minor units for editing", () => {
    expect(formatMinorUnits("1050", "EUR")).toBe("10.50");
    expect(formatMinorUnits("1500", "JPY")).toBe("1500");
    expect(formatMinorUnits("1005", "BHD")).toBe("1.005");
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
    expect(preview.roundingNote).toMatch(/does not divide evenly/);
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
    expect(bad.ok === false && bad.error).toMatch(/100/);

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
    expect(preview.ok === false && preview.error).toMatch(/at least one/);
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
    expect(preview.ok === false && preview.error).toBe("");
  });

  it("formats allocations in the expense currency", () => {
    const preview = previewSplit({
      totalMinor: 3000n,
      currency: "JPY",
      method: "equal",
      participantIds: ["a", "b"],
      values: {},
    });
    expect(preview.ok && preview.allocations[0].formatted).toContain("1,500");
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
