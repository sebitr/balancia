import { describe, expect, it } from "vitest";
import { escapeCsvField, neutralizeFormula, toCsv } from "./csv";

describe("neutralizeFormula", () => {
  it.each(["=", "+", "-", "@", "\t", "\r"])(
    "neutralises a leading %j so a spreadsheet reads it as text",
    (prefix) => {
      expect(neutralizeFormula(`${prefix}HYPERLINK("http://x")`)).toBe(
        `'${prefix}HYPERLINK("http://x")`,
      );
    },
  );

  it("leaves ordinary text alone", () => {
    expect(neutralizeFormula("Dinner at the harbour")).toBe(
      "Dinner at the harbour",
    );
    // A minus inside the value is harmless; only a leading one is a formula.
    expect(neutralizeFormula("Pre-paid taxi")).toBe("Pre-paid taxi");
  });
});

describe("escapeCsvField", () => {
  it("quotes fields containing a comma, quote or newline", () => {
    expect(escapeCsvField("Lisbon, Portugal")).toBe('"Lisbon, Portugal"');
    expect(escapeCsvField('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCsvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("leaves a plain field unquoted", () => {
    expect(escapeCsvField("Dinner")).toBe("Dinner");
  });

  it("renders null and undefined as empty", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("does not neutralise numbers, which are ours rather than user input", () => {
    // Quoting or prefixing here would stop a spreadsheet summing the column.
    expect(escapeCsvField(-12.05)).toBe("-12.05");
    expect(escapeCsvField(0)).toBe("0");
  });

  it("neutralises and then quotes a formula containing a comma", () => {
    expect(escapeCsvField("=SUM(A1,A2)")).toBe('"\'=SUM(A1,A2)"');
  });
});

describe("toCsv", () => {
  it("starts with a byte-order mark so Excel reads it as UTF-8", () => {
    expect(toCsv([["Amélie"]]).startsWith("\uFEFF")).toBe(true);
  });

  it("separates rows with CRLF", () => {
    expect(
      toCsv([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe("\uFEFFa,b\r\nc,d");
  });

  it("keeps accented and non-Latin names intact", () => {
    expect(toCsv([["Amélie", "東京"]])).toContain("Amélie,東京");
  });

  it("renders an empty document as just the mark", () => {
    expect(toCsv([])).toBe("\uFEFF");
  });
});
