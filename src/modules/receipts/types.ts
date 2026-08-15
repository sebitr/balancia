/**
 * What comes out of on-device OCR, and what a receipt is once it has been read.
 *
 * Everything in this module is plain data. The OCR engine that produced it, the
 * runtime it ran on and the browser it ran in are all somebody else's problem —
 * `src/lib/ocr` owns those. Keeping the boundary here is what lets every
 * deterministic decision in `parser.ts`, `validation.ts` and `assignment.ts` be
 * tested against fixtures instead of against a 6 MB model.
 *
 * Amounts are integer minor units, like everywhere else in Balancia. OCR never
 * produces a `number` that reaches the accounting code.
 */

/** Pixel box in the coordinate space of the image that was scanned. */
export interface OcrBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** One recognized text box, as the detector and recognizer found it. */
export interface OcrTextBox {
  readonly text: string;
  readonly box: OcrBox;
  /** Recognizer confidence in [0, 1]. */
  readonly confidence: number;
}

/** The whole output of one scan, before anything has been interpreted. */
export interface OcrResult {
  readonly boxes: readonly OcrTextBox[];
  /** Size of the image the boxes refer to, after preprocessing. */
  readonly width: number;
  readonly height: number;
}

/**
 * Text boxes that share a baseline, merged into a reading order.
 *
 * A receipt line is the unit everything downstream reasons about: a description
 * on the left and an amount on the right are one line even when the detector
 * found them as two boxes — and, just as often, one box.
 */
export interface ReceiptLine {
  /** Segment texts joined with single spaces, left to right. */
  readonly text: string;
  readonly segments: readonly OcrTextBox[];
  /** Union of the segment boxes. */
  readonly box: OcrBox;
  /** Lowest segment confidence: a line is only as good as its worst word. */
  readonly confidence: number;
}

/** A line item, as read. Every field is a proposal the user can overwrite. */
export interface ReceiptItem {
  readonly id: string;
  readonly name: string;
  readonly quantity?: number;
  /** Minor units, per unit, when the receipt stated it separately. */
  readonly unitPrice?: bigint;
  /** Minor units for the whole line. */
  readonly total: bigint;
  /** OCR confidence for the line this came from, in [0, 1]. */
  readonly confidence?: number;
}

/**
 * A parsed receipt.
 *
 * Every field is optional except the items list, because a receipt photographed
 * at an angle in bad light legitimately yields "some lines and no total". The
 * review screen is built to accept that and let someone fill in the rest.
 */
export interface ParsedReceipt {
  readonly merchant?: string;
  /** ISO date, `YYYY-MM-DD`. */
  readonly date?: string;
  /** ISO 4217 code, only when something on the receipt actually named one. */
  readonly currency?: string;
  readonly items: readonly ReceiptItem[];
  readonly subtotal?: bigint;
  readonly tax?: bigint;
  readonly tip?: bigint;
  readonly service?: bigint;
  readonly total?: bigint;
  /** Rough share of the receipt that was read cleanly, in [0, 1]. */
  readonly confidence?: number;
}

/** How a line was understood. Kept out of `ParsedReceipt` — it is a diagnostic. */
export type LineRole =
  | "merchant"
  | "date"
  | "item"
  | "subtotal"
  | "tax"
  | "tip"
  | "service"
  | "total"
  | "ignored";
