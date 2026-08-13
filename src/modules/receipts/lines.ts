import type { OcrBox, OcrTextBox, ReceiptLine } from "./types";

/**
 * Turning scattered text boxes into receipt lines.
 *
 * A text detector finds *regions*, and how it splits them is not stable: the
 * same layout yields `["Margherita 19.00"]` on one photo and `["Margherita",
 * "19.00"]` on the next, depending on how wide the gap rendered. The parser
 * cannot depend on either, so everything is grouped back into lines here and
 * the rest of the pipeline only ever sees a line.
 *
 * Grouping is by vertical overlap rather than by a y threshold, because a
 * receipt photographed in the hand is never perfectly level and a fixed
 * tolerance either merges two rows on a tilted photo or splits one on a
 * straight one.
 */

/** Share of the shorter box's height that must overlap to be the same line. */
const OVERLAP_RATIO = 0.5;

function centerY(box: OcrBox): number {
  return (box.y0 + box.y1) / 2;
}

function height(box: OcrBox): number {
  return Math.max(1, box.y1 - box.y0);
}

function union(a: OcrBox, b: OcrBox): OcrBox {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function overlaps(a: OcrBox, b: OcrBox): boolean {
  const shared = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return shared > OVERLAP_RATIO * Math.min(height(a), height(b));
}

/**
 * Groups text boxes into lines, top to bottom, each line left to right.
 *
 * Boxes with empty text are dropped: a recognizer that returned nothing for a
 * region contributes no information, and keeping it would widen a line's box
 * for no reason.
 */
export function groupLines(boxes: readonly OcrTextBox[]): ReceiptLine[] {
  const usable = boxes.filter((entry) => entry.text.trim() !== "");
  const ordered = [...usable].sort(
    (a, b) => centerY(a.box) - centerY(b.box) || a.box.x0 - b.box.x0,
  );

  const groups: { box: OcrBox; segments: OcrTextBox[] }[] = [];
  for (const entry of ordered) {
    // Only the most recent few groups can still be open on a sorted input;
    // scanning them all is fine at receipt scale and simpler to reason about.
    const target = groups.find((group) => overlaps(group.box, entry.box));
    if (target) {
      target.segments.push(entry);
      target.box = union(target.box, entry.box);
    } else {
      groups.push({ box: entry.box, segments: [entry] });
    }
  }

  return groups
    .map((group) => {
      const segments = [...group.segments].sort((a, b) => a.box.x0 - b.box.x0);
      return {
        text: segments
          .map((segment) => segment.text.trim())
          .filter((text) => text !== "")
          .join(" "),
        segments,
        box: group.box,
        // A line is only as trustworthy as its least certain part.
        confidence: segments.reduce(
          (lowest, segment) => Math.min(lowest, segment.confidence),
          1,
        ),
      } satisfies ReceiptLine;
    })
    .filter((line) => line.text !== "")
    .sort((a, b) => centerY(a.box) - centerY(b.box));
}

/**
 * Median line height, used to reason about the page in units of text rather
 * than pixels — a scan at 600 px and the same receipt at 2400 px should be
 * read identically.
 */
export function medianLineHeight(lines: readonly ReceiptLine[]): number {
  if (lines.length === 0) return 0;
  const heights = lines.map((line) => height(line.box)).sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)];
}
