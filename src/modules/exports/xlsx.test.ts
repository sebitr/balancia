import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  buildXlsx,
  columnName,
  escapeXml,
  sanitizeSheetName,
  xlsxNumber,
} from "./xlsx";

/**
 * The writer produces a binary format, so these tests unzip what it built and
 * assert on the parts. Anything less would only prove that it did not throw.
 */

function unzip(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  return Object.fromEntries(
    Object.entries(files).map(([path, content]) => [path, strFromU8(content)]),
  );
}

describe("escapeXml", () => {
  it("escapes every character that would break out of XML content", () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      "a &amp; b &lt; c &gt; d &quot; e &apos; f",
    );
  });

  it("strips the control characters XML 1.0 forbids", () => {
    // A NUL or a vertical tab in a description would make the whole workbook
    // unreadable rather than merely look wrong.
    expect(escapeXml("Din\u0000ner\u001F at\u000B sea")).toBe("Dinner at sea");
  });

  it("keeps tab, newline and carriage return, which are legal", () => {
    expect(escapeXml("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });

  it("leaves accented and non-Latin text alone", () => {
    expect(escapeXml("Amélie · 東京")).toBe("Amélie · 東京");
  });
});

describe("sanitizeSheetName", () => {
  it("replaces the characters Excel refuses", () => {
    expect(sanitizeSheetName("Trip: Paris/Lyon [2026]?")).toBe(
      "Trip Paris Lyon 2026",
    );
  });

  it("truncates to 31 characters", () => {
    const name = sanitizeSheetName("A".repeat(40));
    expect(name).toHaveLength(31);
  });

  it("falls back rather than producing an empty name", () => {
    expect(sanitizeSheetName("   ")).toBe("Sheet");
    expect(sanitizeSheetName("[]")).toBe("Sheet");
  });

  it("strips wrapping apostrophes", () => {
    expect(sanitizeSheetName("'Expenses'")).toBe("Expenses");
  });
});

describe("columnName", () => {
  it("counts in spreadsheet columns", () => {
    expect(columnName(1)).toBe("A");
    expect(columnName(26)).toBe("Z");
    expect(columnName(27)).toBe("AA");
    expect(columnName(52)).toBe("AZ");
    expect(columnName(53)).toBe("BA");
    expect(columnName(702)).toBe("ZZ");
    expect(columnName(703)).toBe("AAA");
  });
});

describe("buildXlsx", () => {
  it("writes every part a workbook needs", () => {
    const files = unzip(
      buildXlsx([{ name: "Expenses", rows: [["Date", "Amount"]] }]),
    );

    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  it("declares one sheet part, override and relationship per sheet", () => {
    const files = unzip(
      buildXlsx([
        { name: "Expenses", rows: [["a"]] },
        { name: "Payments", rows: [["b"]] },
        { name: "People", rows: [["c"]] },
      ]),
    );

    expect(files["xl/worksheets/sheet3.xml"]).toBeDefined();
    expect(files["[Content_Types].xml"]).toContain(
      "/xl/worksheets/sheet3.xml",
    );
    expect(files["xl/_rels/workbook.xml.rels"]).toContain(
      'Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"',
    );
    expect(files["xl/workbook.xml"]).toContain(
      '<sheet name="People" sheetId="3" r:id="rId3"/>',
    );
  });

  it("writes text as inline strings and numbers as numeric cells", () => {
    const sheet = unzip(
      buildXlsx([
        {
          name: "Expenses",
          rows: [["Dinner", xlsxNumber("148.60"), 3]],
        },
      ]),
    )["xl/worksheets/sheet1.xml"];

    expect(sheet).toContain(
      '<c r="A1" t="inlineStr"><is><t xml:space="preserve">Dinner</t></is></c>',
    );
    expect(sheet).toContain('<c r="B1"><v>148.60</v></c>');
    expect(sheet).toContain('<c r="C1"><v>3</v></c>');
  });

  it("carries a money literal through unrounded", () => {
    // The point of xlsxNumber: Number("9007199254740993.45") would lose digits.
    const sheet = unzip(
      buildXlsx([
        { name: "Big", rows: [[xlsxNumber("9007199254740993.45")]] },
      ]),
    )["xl/worksheets/sheet1.xml"];

    expect(sheet).toContain("<v>9007199254740993.45</v>");
  });

  it("escapes cell text rather than emitting raw markup", () => {
    const sheet = unzip(
      buildXlsx([
        { name: "Expenses", rows: [['Bar & "Grill" <b>'], ["Amélie"]] },
      ]),
    )["xl/worksheets/sheet1.xml"];

    expect(sheet).toContain("Bar &amp; &quot;Grill&quot; &lt;b&gt;");
    expect(sheet).not.toContain("<b>");
    expect(sheet).toContain("Amélie");
  });

  it("escapes sheet names in the workbook part", () => {
    const files = unzip(buildXlsx([{ name: "Bar & Grill", rows: [["a"]] }]));
    expect(files["xl/workbook.xml"]).toContain('name="Bar &amp; Grill"');
  });

  it("disambiguates sheet names that collide after sanitising", () => {
    const workbook = unzip(
      buildXlsx([
        { name: "Trip: Paris", rows: [["a"]] },
        { name: "Trip/Paris", rows: [["b"]] },
      ]),
    )["xl/workbook.xml"];

    expect(workbook).toContain('name="Trip Paris"');
    expect(workbook).toContain('name="Trip Paris 2"');
  });

  it("omits empty cells but keeps the row and later column references", () => {
    const sheet = unzip(
      buildXlsx([{ name: "Gaps", rows: [["a", null, "", undefined, "e"]] }]),
    )["xl/worksheets/sheet1.xml"];

    expect(sheet).toContain('<row r="1">');
    expect(sheet).toContain('r="A1"');
    expect(sheet).not.toContain('r="B1"');
    // The fifth value still lands in column E, not column B.
    expect(sheet).toContain('r="E1"');
  });

  it("writes a valid sheet for a table with no rows", () => {
    const sheet = unzip(buildXlsx([{ name: "Empty", rows: [] }]))[
      "xl/worksheets/sheet1.xml"
    ];
    expect(sheet).toContain("<sheetData></sheetData>");
  });

  it("refuses a workbook with no sheets", () => {
    expect(() => buildXlsx([])).toThrow(/at least one sheet/);
  });

  it("is byte-identical for identical data", () => {
    const sheets = [{ name: "Expenses", rows: [["Dinner", xlsxNumber("10")]] }];
    expect(buildXlsx(sheets)).toEqual(buildXlsx(sheets));
  });
});
