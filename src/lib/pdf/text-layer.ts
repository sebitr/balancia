import type { OcrBox, OcrResult, OcrTextBox } from "@/modules/receipts";

/**
 * A PDF that was made by a computer already knows what it says.
 *
 * An emailed invoice, a hotel folio, a train ticket — none of these are
 * photographs. Each carries a text layer: every string, its font size, and the
 * matrix that places it on the page. Running OCR over a rasterization of that
 * would be reading a fax of a document already in hand, and it would lose to
 * it: recognition guesses at `0` against `O`, and this does not guess.
 *
 * So the text layer is converted into the same `OcrTextBox` shape the
 * recognizer produces, and everything downstream — `groupLines`,
 * `parseReceipt`, `validateReceipt` — runs unchanged and unaware. The whole
 * point of `src/modules/receipts` taking boxes rather than an engine is that a
 * second source of boxes costs nothing to add.
 *
 * Nothing here imports pdf.js. It takes the plain shapes pdf.js hands back, so
 * the arithmetic deciding *where* a line is can be tested in Node against a
 * real PDF, with no browser, no canvas and no model.
 */

/* ------------------------------------------------------------ pdf.js shapes */

/**
 * The part of pdf.js's `TextItem` this needs.
 *
 * `transform` is the run's text matrix in PDF user space — y upwards from the
 * bottom-left corner. `width` is its advance in *unscaled* PDF units: alone
 * among the geometry it does not follow the viewport scale, which is the one
 * trap in this conversion and the reason `place` multiplies it by hand.
 */
export interface PdfTextItem {
  readonly str: string;
  readonly transform: readonly number[];
  readonly width: number;
}

/** The part of pdf.js's `PageViewport` this needs. */
export interface PdfViewport {
  /** PDF user space onto pixels, y downwards. Carries any page rotation. */
  readonly transform: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

/** One page's boxes, in that page's own pixel space. */
export interface PdfPageBoxes {
  readonly boxes: readonly OcrTextBox[];
  readonly width: number;
  readonly height: number;
}

/* ----------------------------------------------------------------- geometry */

/**
 * Where a glyph box sits around the baseline, as a share of the font size.
 *
 * A text detector returns a box drawn tightly round ink. A PDF gives a
 * baseline and a font size and says nothing about ink at all. These two
 * numbers turn one into the other, and they are roughly Helvetica's ascender
 * and descender because roughly is all that is needed: the boxes are only ever
 * compared with each other — by `groupLines` deciding which share a row, and
 * by `medianLineHeight` measuring the page in lines rather than pixels.
 */
const ASCENT = 0.8;
const DESCENT = 0.2;

/**
 * How close two consecutive runs must be to be one word.
 *
 * pdf.js splits a line wherever the content stream repositions or changes
 * font, which happens mid-word for kerned or part-bold text, and it emits an
 * explicit space run wherever it judges there to be a gap. Neither is worth
 * depending on, so adjacency is decided geometrically: closer than a quarter
 * of the font size is a split word and is rejoined here; anything wider is
 * left as two boxes for `groupLines` to rejoin with a space. A PDF that emits
 * spaces and one that does not then come out the same.
 */
const JOIN_GAP_EM = 0.25;

/** How far left of the last run a following one may start and still join it. */
const BACKTRACK_EM = 0.5;

/** Share of the shorter box's height that must overlap to be the same row. */
const ROW_OVERLAP = 0.5;

/**
 * Blank space between stacked pages, as a share of page height.
 *
 * Not cosmetic: it keeps the last line of one page and the first of the next
 * from being read as one row when a page draws slightly outside its own box.
 */
const PAGE_GAP = 0.02;

/** pdf.js's `Util.transform`: `a` applied to `b`. Six multiply-adds, not a dependency. */
function compose(a: readonly number[], b: readonly number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function union(a: OcrBox, b: OcrBox): OcrBox {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function sameRow(a: OcrBox, b: OcrBox): boolean {
  const shared = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const shorter = Math.min(Math.max(1, a.y1 - a.y0), Math.max(1, b.y1 - b.y0));
  return shared > ROW_OVERLAP * shorter;
}

interface PlacedRun {
  readonly box: OcrBox;
  /** Font size in page pixels — the unit gaps between runs are judged in. */
  readonly fontSize: number;
}

/**
 * Where one run of text lands on the page, in pixels with y downwards.
 *
 * The run is treated as a rectangle in its own text space and all four corners
 * are transformed, so text set at an angle — a rotated column heading, a
 * diagonal "PAID" — yields a box that actually covers it instead of one
 * measured along the wrong axis.
 */
function place(item: PdfTextItem, viewport: PdfViewport): PlacedRun | null {
  const [a, b, c, d, e, f] = compose(viewport.transform, item.transform);

  // The em box's own axes in page pixels: `along` runs with the text, `up`
  // stands perpendicular to it.
  const fontSize = Math.hypot(c, d);
  const advance = Math.hypot(a, b);
  if (!(fontSize > 0) || !Number.isFinite(e) || !Number.isFinite(f))
    return null;

  // The one quantity the viewport transform did not already scale.
  const length = item.width * viewport.scale;

  const alongX = advance > 0 ? a / advance : 1;
  const alongY = advance > 0 ? b / advance : 0;
  const upX = c / fontSize;
  const upY = d / fontSize;

  const xs: number[] = [];
  const ys: number[] = [];
  for (const distance of [0, length]) {
    for (const rise of [-DESCENT * fontSize, ASCENT * fontSize]) {
      xs.push(e + alongX * distance + upX * rise);
      ys.push(f + alongY * distance + upY * rise);
    }
  }

  return {
    box: {
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
    },
    fontSize,
  };
}

/** Whether any part of the box is on the printed page. */
function onPage(box: OcrBox, viewport: PdfViewport): boolean {
  return (
    box.x1 > 0 &&
    box.y1 > 0 &&
    box.x0 < viewport.width &&
    box.y0 < viewport.height
  );
}

/* -------------------------------------------------------------- conversion */

/**
 * One page's text runs as boxes.
 *
 * Confidence is 1 throughout, and that is not optimism: the characters were
 * read out of the file rather than inferred from pixels. Downstream code
 * weighs boxes by confidence to decide what to flag for checking, and a text
 * layer has nothing to flag.
 *
 * Runs drawn entirely off the page are dropped. A PDF may place text outside
 * its media box — a print mark, a template's unused field, an author's note —
 * and none of it is on the receipt the reader is holding.
 */
export function pageTextBoxes(
  items: readonly PdfTextItem[],
  viewport: PdfViewport,
): PdfPageBoxes {
  const boxes: OcrTextBox[] = [];

  let pendingText = "";
  let pendingBox: OcrBox | null = null;
  let pendingFontSize = 0;

  const flush = () => {
    if (pendingBox && pendingText.trim() !== "") {
      boxes.push({ text: pendingText, box: pendingBox, confidence: 1 });
    }
    pendingText = "";
    pendingBox = null;
    pendingFontSize = 0;
  };

  for (const item of items) {
    // pdf.js marks line ends with an empty run and word gaps with a space run.
    // Either way there is nothing to draw, and the word before it has ended.
    if (item.str.trim() === "") {
      flush();
      continue;
    }

    const placed = place(item, viewport);
    if (!placed || !onPage(placed.box, viewport)) {
      flush();
      continue;
    }

    const gap = pendingBox ? placed.box.x0 - pendingBox.x1 : Infinity;
    const joins =
      pendingBox !== null &&
      sameRow(pendingBox, placed.box) &&
      gap <= JOIN_GAP_EM * pendingFontSize &&
      gap >= -BACKTRACK_EM * pendingFontSize;

    if (joins && pendingBox) {
      pendingText += item.str;
      pendingBox = union(pendingBox, placed.box);
      pendingFontSize = Math.max(pendingFontSize, placed.fontSize);
    } else {
      flush();
      pendingText = item.str;
      pendingBox = placed.box;
      pendingFontSize = placed.fontSize;
    }
  }
  flush();

  return { boxes, width: viewport.width, height: viewport.height };
}

/**
 * Several pages as one scan.
 *
 * A restaurant bill is one page; a hotel folio is three, with the total on the
 * last of them. Stacking pages into a single coordinate space — rather than
 * parsing each and merging the results — means the parser sees the document in
 * reading order and needs to know nothing about pages at all.
 */
export function stackPages(pages: readonly PdfPageBoxes[]): OcrResult {
  const boxes: OcrTextBox[] = [];
  let offset = 0;
  let width = 0;

  for (const page of pages) {
    for (const entry of page.boxes) {
      boxes.push({
        ...entry,
        box: {
          ...entry.box,
          y0: entry.box.y0 + offset,
          y1: entry.box.y1 + offset,
        },
      });
    }
    width = Math.max(width, page.width);
    offset += page.height * (1 + PAGE_GAP);
  }

  const last = pages[pages.length - 1];
  return {
    boxes,
    width: Math.round(width),
    // The trailing gap belongs to no page: the document ends with the last one.
    height: Math.round(last ? offset - last.height * PAGE_GAP : 0),
  };
}

/* ------------------------------------------------------------- is it usable */

/**
 * The least text worth preferring over OCR.
 *
 * A scanned PDF is not always textless. It may carry a page number stamped by
 * the scanner, a fax header, or the two words of a digital signature — enough
 * to make `boxes.length > 0` true and nowhere near enough to be the receipt.
 * Below these thresholds the page is rasterized and read as a photograph
 * instead, which is the right answer for a scan and no worse than nothing for
 * a genuinely near-empty document.
 */
const MIN_BOXES = 4;
const MIN_CHARACTERS = 24;

export function hasUsableTextLayer(result: OcrResult): boolean {
  if (result.boxes.length < MIN_BOXES) return false;
  const characters = result.boxes.reduce(
    (total, entry) => total + entry.text.trim().length,
    0,
  );
  return characters >= MIN_CHARACTERS;
}
