import { describe, expect, it } from "vitest";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import {
  hasUsableTextLayer,
  pageTextBoxes,
  stackPages,
  type PdfPageBoxes,
  type PdfTextItem,
  type PdfViewport,
} from "./text-layer";
import { groupLines, parseReceipt } from "@/modules/receipts";
import {
  buildOcrResult,
  FRENCH_BISTRO,
  GERMAN_RESTAURANT,
  ITALIAN_BARE_QUANTITY,
  ITALIAN_TRATTORIA,
  LARGE_AMOUNTS,
  QUANTITY_AND_SERVICE,
  SWISS_RESTAURANT,
  US_RESTAURANT,
  type FixtureLine,
} from "@/modules/receipts/test-fixtures";

/**
 * Two kinds of test live here, and they check different things.
 *
 * The first kind feeds hand-written items to `pageTextBoxes` to pin the
 * arithmetic: a wrong sign or a forgotten scale is not a crash, it is boxes in
 * the wrong place and a receipt that reads as gibberish.
 *
 * The second builds *actual PDF files* out of the receipt fixtures the parser
 * is already tested against, runs them back through real pdf.js, and demands
 * the same `ParsedReceipt` the box fixtures produce. That is the claim worth
 * making — a PDF and a perfect scan of the same receipt are the same receipt —
 * and it is one no amount of synthetic input could establish.
 */

/* ------------------------------------------------------- building a PDF */

const PAGE_WIDTH = 640;
const TOP = 20;
const LINE_HEIGHT = 30;
const FONT_SIZE = 16;
const LEFT = 40;
const RIGHT_COLUMN = 400;

/** PDF string literals escape exactly three characters. */
function escapePdf(text: string): string {
  return text.replace(/([\\()])/g, "\\$1");
}

/**
 * A real, valid, single- or multi-page PDF holding the given receipt lines.
 *
 * Written out by hand rather than generated with a library: the point is to
 * hand pdf.js a file it has never seen, and a library that shares assumptions
 * with the reader would quietly test one half of the round trip twice.
 *
 * Only the parts of the format this needs are here — one Type1 base font, no
 * compression, no metadata. Every fixture is ASCII, which is asserted rather
 * than assumed, so byte offsets can be counted in characters.
 */
function buildReceiptPdf(
  pages: readonly (readonly FixtureLine[])[],
): Uint8Array {
  const objects: string[] = [];
  /** Appends an object and returns its number, which PDF counts from 1. */
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  const catalog = add("");
  const pageTree = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const pageNumbers: number[] = [];
  for (const lines of pages) {
    const height = TOP * 2 + lines.length * LINE_HEIGHT;

    const draw: string[] = [];
    lines.forEach((line, index) => {
      // PDF measures y upwards from the bottom of the page; the fixtures, like
      // every other coordinate in this codebase, measure it downwards.
      const baseline = height - (TOP + index * LINE_HEIGHT + FONT_SIZE);
      const put = (text: string, x: number) => {
        if (text === "") return;
        if (!/^[\x20-\x7e]*$/.test(text)) {
          throw new Error(`fixture text is not ASCII: ${text}`);
        }
        draw.push(
          `BT /F1 ${FONT_SIZE} Tf 1 0 0 1 ${x} ${baseline} Tm ` +
            `(${escapePdf(text)}) Tj ET`,
        );
      };

      if (typeof line === "string") {
        put(line, LEFT);
      } else {
        put(line[0], LEFT);
        put(line[1], RIGHT_COLUMN);
      }
    });

    const content = `${draw.join("\n")}\n`;
    const stream = add(
      `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    );
    pageNumbers.push(
      add(
        `<< /Type /Page /Parent ${pageTree} 0 R ` +
          `/MediaBox [0 0 ${PAGE_WIDTH} ${height}] ` +
          `/Resources << /Font << /F1 ${font} 0 R >> >> ` +
          `/Contents ${stream} 0 R >>`,
      ),
    );
  }

  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] =
    `<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(" ")}] ` +
    `/Count ${pageNumbers.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\n` +
    `startxref\n${xref}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

/** Reads a PDF back the way `document.ts` does, but in Node and without it. */
async function readPages(
  bytes: Uint8Array,
  scale = 1,
): Promise<PdfPageBoxes[]> {
  // The legacy build is the one that runs outside a browser; the application
  // loads the modern one. Only the plumbing differs — the text layer these
  // tests are about is identical.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes });

  try {
    const document = await task.promise;
    const pages: PdfPageBoxes[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        pageTextBoxes(
          content.items.filter((item): item is TextItem => "str" in item),
          page.getViewport({ scale }),
        ),
      );
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/* ------------------------------------------------------------- placement */

/** A viewport of the shape pdf.js builds: y flipped, origin moved to the top. */
function viewportAt(scale: number, height = 300): PdfViewport {
  return {
    transform: [scale, 0, 0, -scale, 0, height * scale],
    width: PAGE_WIDTH * scale,
    height: height * scale,
    scale,
  };
}

/** One run of 12pt text with its baseline 100 units up from the page bottom. */
function run(overrides: Partial<PdfTextItem> = {}): PdfTextItem {
  return {
    str: "Espresso",
    transform: [12, 0, 0, 12, 50, 100],
    width: 45,
    ...overrides,
  };
}

describe("pageTextBoxes", () => {
  it("puts a run where the page puts it, measured from the top", () => {
    const { boxes } = pageTextBoxes([run()], viewportAt(1));

    expect(boxes).toHaveLength(1);
    // Baseline 100 up from a 300-tall page is 200 down from its top; the box
    // reaches 0.8em above that baseline and 0.2em below it.
    expect(boxes[0].box).toEqual({
      x0: 50,
      y0: 200 - 0.8 * 12,
      x1: 50 + 45,
      y1: 200 + 0.2 * 12,
    });
  });

  it("scales the advance width, which pdf.js reports unscaled", () => {
    // The bug this exists for: every other number comes out of the viewport
    // transform already scaled, and `item.width` does not. Miss it and boxes
    // are the right height and half the width at scale 2.
    const single = pageTextBoxes([run()], viewportAt(1)).boxes[0].box;
    const double = pageTextBoxes([run()], viewportAt(2)).boxes[0].box;

    expect(double.x1 - double.x0).toBeCloseTo(2 * (single.x1 - single.x0));
    expect(double.y1 - double.y0).toBeCloseTo(2 * (single.y1 - single.y0));
    expect(double.x0).toBeCloseTo(2 * single.x0);
    expect(double.y0).toBeCloseTo(2 * single.y0);
  });

  it("reads text from the file at full confidence", () => {
    // Not optimism: the characters were read, not inferred. Downstream code
    // flags low-confidence lines for checking, and there is nothing to flag.
    const { boxes } = pageTextBoxes([run()], viewportAt(1));
    expect(boxes[0].confidence).toBe(1);
  });

  it("covers rotated text along its own axis", () => {
    // A quarter turn: the run should become tall rather than wide.
    const rotated = run({ transform: [0, 12, -12, 0, 50, 100] });
    const { boxes } = pageTextBoxes([rotated], viewportAt(1));

    expect(boxes[0].box.y0 - boxes[0].box.y1).toBeCloseTo(-45, 5);
    expect(boxes[0].box.x1 - boxes[0].box.x0).toBeCloseTo(12, 5);
  });

  it("rejoins a word the content stream split", () => {
    // Kerning and a mid-word font change both do this, and a naive reader
    // turns "Total" into "Tot al".
    const { boxes } = pageTextBoxes(
      [
        run({ str: "Tot", width: 21 }),
        run({ str: "al", transform: [12, 0, 0, 12, 71, 100], width: 12 }),
      ],
      viewportAt(1),
    );

    expect(boxes.map((entry) => entry.text)).toEqual(["Total"]);
  });

  it("leaves a real gap as two boxes for groupLines to space", () => {
    const { boxes } = pageTextBoxes(
      [
        run({ str: "Espresso", width: 45 }),
        run({ str: "2.50", transform: [12, 0, 0, 12, 400, 100], width: 24 }),
      ],
      viewportAt(1),
    );

    expect(boxes.map((entry) => entry.text)).toEqual(["Espresso", "2.50"]);
    expect(groupLines(boxes).map((line) => line.text)).toEqual([
      "Espresso 2.50",
    ]);
  });

  it("does not join across a row", () => {
    const { boxes } = pageTextBoxes(
      [
        run({ str: "Tot", width: 21 }),
        run({ str: "al", transform: [12, 0, 0, 12, 71, 130], width: 12 }),
      ],
      viewportAt(1),
    );

    expect(boxes.map((entry) => entry.text)).toEqual(["al", "Tot"].reverse());
  });

  it("ends a word at the space pdf.js inserts", () => {
    // pdf.js emits an explicit blank run for a gap it considers a space. It is
    // dropped, but it still ends the word before it.
    const { boxes } = pageTextBoxes(
      [
        run({ str: "Tot", width: 21 }),
        run({ str: " ", transform: [12, 0, 0, 12, 71, 100], width: 2 }),
        run({ str: "al", transform: [12, 0, 0, 12, 73, 100], width: 12 }),
      ],
      viewportAt(1),
    );

    expect(boxes.map((entry) => entry.text)).toEqual(["Tot", "al"]);
  });

  it("drops text drawn off the page", () => {
    // Template fields and print marks live out here. None of it is printed,
    // so none of it is on the receipt.
    const { boxes } = pageTextBoxes(
      [
        run({ str: "on the page" }),
        run({ str: "above it", transform: [12, 0, 0, 12, 50, 400] }),
        run({ str: "left of it", transform: [12, 0, 0, 12, -900, 100] }),
      ],
      viewportAt(1),
    );

    expect(boxes.map((entry) => entry.text)).toEqual(["on the page"]);
  });
});

/* ---------------------------------------------------------------- pages */

describe("stackPages", () => {
  const page = (y: number, height: number): PdfPageBoxes => ({
    boxes: [
      {
        text: "line",
        box: { x0: 10, y0: y, x1: 60, y1: y + 12 },
        confidence: 1,
      },
    ],
    width: 400,
    height,
  });

  it("lays later pages under earlier ones", () => {
    const result = stackPages([page(500, 600), page(20, 600)]);

    expect(result.boxes[0].box.y0).toBe(500);
    expect(result.boxes[1].box.y0).toBeGreaterThan(600);
  });

  it("keeps the seam wide enough that no row straddles it", () => {
    // Last line of page one, first line of page two: adjacent in the stack and
    // still separate rows.
    const result = stackPages([page(585, 600), page(0, 600)]);
    expect(groupLines(result.boxes)).toHaveLength(2);
  });

  it("is as wide as its widest page and as tall as the stack", () => {
    const result = stackPages([
      { boxes: [], width: 400, height: 600 },
      { boxes: [], width: 500, height: 300 },
    ]);

    expect(result.width).toBe(500);
    // Both pages plus one seam, and no trailing gap after the last page.
    expect(result.height).toBe(600 + Math.round(600 * 0.02) + 300);
  });

  it("has no pages to stack", () => {
    expect(stackPages([])).toEqual({ boxes: [], width: 0, height: 0 });
  });
});

describe("hasUsableTextLayer", () => {
  const layer = (texts: readonly string[]) => ({
    boxes: texts.map((text, index) => ({
      text,
      box: { x0: 0, y0: index * 20, x1: 100, y1: index * 20 + 12 },
      confidence: 1,
    })),
    width: 400,
    height: 600,
  });

  it("accepts a receipt's worth of text", () => {
    expect(
      hasUsableTextLayer(
        layer(["Casa Italia", "Margherita", "19.00", "TOTAL", "19.00"]),
      ),
    ).toBe(true);
  });

  it("rejects the page number a scanner stamped on an image", () => {
    // The case this exists for: a scan is not always textless, and a text
    // layer of "Page 1 of 2" would otherwise beat OCR to the receipt.
    expect(hasUsableTextLayer(layer(["Page 1 of 2"]))).toBe(false);
  });

  it("rejects many boxes that say almost nothing", () => {
    expect(hasUsableTextLayer(layer(["1", "2", "3", "4", "5"]))).toBe(false);
  });

  it("rejects a page of whitespace", () => {
    expect(hasUsableTextLayer(layer(["  ", " ", "\t", "   ", " "]))).toBe(
      false,
    );
  });
});

/* ------------------------------------------------------ against real PDFs */

const FIXTURES: readonly (readonly [string, readonly FixtureLine[]])[] = [
  ["SWISS_RESTAURANT", SWISS_RESTAURANT],
  ["FRENCH_BISTRO", FRENCH_BISTRO],
  ["GERMAN_RESTAURANT", GERMAN_RESTAURANT],
  ["ITALIAN_TRATTORIA", ITALIAN_TRATTORIA],
  ["US_RESTAURANT", US_RESTAURANT],
  ["QUANTITY_AND_SERVICE", QUANTITY_AND_SERVICE],
  ["LARGE_AMOUNTS", LARGE_AMOUNTS],
  ["ITALIAN_BARE_QUANTITY", ITALIAN_BARE_QUANTITY],
];

/** The currency a receipt that names none is read in, as the dialog passes it. */
const OPTIONS = { fallbackCurrency: "EUR" } as const;

/** Everything a `ParsedReceipt` claims about the receipt, minus its confidence. */
function claims(receipt: ReturnType<typeof parseReceipt>) {
  return {
    merchant: receipt.merchant,
    date: receipt.date,
    currency: receipt.currency,
    subtotal: receipt.subtotal,
    tax: receipt.tax,
    tip: receipt.tip,
    service: receipt.service,
    total: receipt.total,
    items: receipt.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total,
    })),
  };
}

describe("a real PDF, through real pdf.js", () => {
  it.each(FIXTURES)(
    "reads %s exactly as a perfect scan does",
    async (_name, lines) => {
      const pages = await readPages(buildReceiptPdf([lines]));
      const fromPdf = parseReceipt(stackPages(pages), OPTIONS);
      const fromBoxes = parseReceipt(buildOcrResult(lines), OPTIONS);

      expect(claims(fromPdf)).toEqual(claims(fromBoxes));
    },
  );

  it("is certain of every line, where a scan is not", async () => {
    const pages = await readPages(buildReceiptPdf([SWISS_RESTAURANT]));
    const receipt = parseReceipt(stackPages(pages), OPTIONS);

    expect(receipt.items.length).toBeGreaterThan(0);
    for (const item of receipt.items) expect(item.confidence).toBe(1);
  });

  it("reads a two-page bill as one receipt", async () => {
    // The total lives on the second page, which is the whole difficulty: a
    // reader that stopped at page one would find items and no total.
    const first = SWISS_RESTAURANT.slice(0, 8);
    const second = SWISS_RESTAURANT.slice(8);

    const pages = await readPages(buildReceiptPdf([first, second]));
    expect(pages).toHaveLength(2);

    const receipt = parseReceipt(stackPages(pages), OPTIONS);
    const whole = parseReceipt(buildOcrResult(SWISS_RESTAURANT), OPTIONS);
    expect(claims(receipt)).toEqual(claims(whole));
  });

  it("reads the same receipt at any rendering scale", async () => {
    // A fresh copy per read: `getDocument` transfers the buffer to its worker
    // and leaves the caller holding a detached one.
    const bill = () => buildReceiptPdf([FRENCH_BISTRO]);
    const one = parseReceipt(stackPages(await readPages(bill(), 1)), OPTIONS);
    const three = parseReceipt(stackPages(await readPages(bill(), 3)), OPTIONS);

    expect(claims(three)).toEqual(claims(one));
  });
});
