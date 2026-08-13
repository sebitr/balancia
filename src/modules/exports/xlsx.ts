import { strToU8, zipSync } from "fflate";

/**
 * Minimal XLSX writer.
 *
 * An .xlsx file is a ZIP of XML parts. This writes the smallest subset that
 * every spreadsheet application accepts: inline strings, no shared-string
 * table, no styles, no calculation chain. That keeps the writer small enough to
 * read in one sitting and to test by unzipping the result.
 *
 * Why not a library: the maintained options are either an order of magnitude
 * larger than the whole feature or stale on npm, and Balancia audits every
 * production dependency by hand. `fflate` (MIT, no transitive dependencies)
 * supplies the ZIP container; the ~100 lines below supply the rest.
 *
 * Money never passes through a JavaScript number here. `xlsxNumber` takes the
 * decimal literal the money module already produced and writes it verbatim
 * into the cell, so the value in the sheet is the value in the database.
 */

/** A numeric cell whose value is carried as an exact decimal literal. */
export interface XlsxNumber {
  readonly kind: "number";
  readonly literal: string;
}

export type XlsxCell = string | number | null | undefined | XlsxNumber;

export interface XlsxSheet {
  readonly name: string;
  /** First row included — this writer does not treat headers specially. */
  readonly rows: readonly (readonly XlsxCell[])[];
}

/**
 * Wraps an already-formatted decimal string as a numeric cell.
 *
 * Use this for money: `xlsxNumber(toMajorString(amount))` keeps the exact
 * figure, where `Number(...)` would round it to the nearest double first.
 */
export function xlsxNumber(literal: string): XlsxNumber {
  return { kind: "number", literal };
}

const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/**
 * Escapes text for XML content and strips the control characters XML 1.0
 * forbids outright — a stray 0x00 in a description would make the whole
 * workbook unreadable rather than just look wrong.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Excel rejects a workbook whose sheet name is empty, longer than 31
 * characters, contains `: \ / ? * [ ]`, or is wrapped in apostrophes. Names
 * must also be unique, so `uniqueSheetNames` disambiguates after truncation.
 */
export function sanitizeSheetName(name: string): string {
  const cleaned = name
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "")
    .slice(0, 31)
    .trim();
  return cleaned === "" ? "Sheet" : cleaned;
}

function uniqueSheetNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.map((name) => {
    const base = sanitizeSheetName(name);
    if (!seen.has(base.toLowerCase())) {
      seen.add(base.toLowerCase());
      return base;
    }
    // Append a counter, trimming the base so the result still fits in 31.
    for (let counter = 2; ; counter += 1) {
      const suffix = ` ${counter}`;
      const candidate = base.slice(0, 31 - suffix.length) + suffix;
      if (!seen.has(candidate.toLowerCase())) {
        seen.add(candidate.toLowerCase());
        return candidate;
      }
    }
  });
}

/** Spreadsheet column reference: 1 → A, 26 → Z, 27 → AA. */
export function columnName(index: number): string {
  let result = "";
  let remaining = index;
  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    result = String.fromCharCode(65 + modulo) + result;
    remaining = Math.floor((remaining - modulo) / 26);
  }
  return result;
}

function cellXml(cell: XlsxCell, reference: string): string {
  if (cell === null || cell === undefined || cell === "") return "";
  if (typeof cell === "number") {
    // A non-finite number has no valid cell representation; write the text.
    return Number.isFinite(cell)
      ? `<c r="${reference}"><v>${cell}</v></c>`
      : `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(String(cell))}</t></is></c>`;
  }
  if (typeof cell === "object") {
    return `<c r="${reference}"><v>${escapeXml(cell.literal)}</v></c>`;
  }
  // `xml:space="preserve"` keeps leading and trailing spaces in a name intact.
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) =>
          cellXml(cell, `${columnName(columnIndex + 1)}${rowIndex + 1}`),
        )
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return `${XML_DECLARATION}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

function contentTypesXml(sheetCount: number): string {
  const overrides = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");

  return `${XML_DECLARATION}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`;
}

function workbookXml(names: readonly string[]): string {
  const sheets = names
    .map(
      (name, index) =>
        `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");

  return `${XML_DECLARATION}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

function workbookRelsXml(sheetCount: number): string {
  const relationships = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");

  return `${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`;
}

const ROOT_RELS_XML = `${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

/**
 * A fixed modification time, so exporting the same data twice produces byte
 * identical files. Anyone diffing two exports should see data changes only.
 */
const FIXED_MTIME = new Date("2020-01-01T00:00:00Z");

/** Builds a workbook. At least one sheet is required. */
export function buildXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  if (sheets.length === 0) {
    throw new Error("A workbook needs at least one sheet");
  }

  const names = uniqueSheetNames(sheets.map((sheet) => sheet.name));

  const parts: Record<string, [Uint8Array, { mtime: Date }]> = {
    "[Content_Types].xml": [
      strToU8(contentTypesXml(sheets.length)),
      { mtime: FIXED_MTIME },
    ],
    "_rels/.rels": [strToU8(ROOT_RELS_XML), { mtime: FIXED_MTIME }],
    "xl/workbook.xml": [strToU8(workbookXml(names)), { mtime: FIXED_MTIME }],
    "xl/_rels/workbook.xml.rels": [
      strToU8(workbookRelsXml(sheets.length)),
      { mtime: FIXED_MTIME },
    ],
  };

  sheets.forEach((sheet, index) => {
    parts[`xl/worksheets/sheet${index + 1}.xml`] = [
      strToU8(sheetXml(sheet)),
      { mtime: FIXED_MTIME },
    ];
  });

  return zipSync(parts, { level: 6 });
}
