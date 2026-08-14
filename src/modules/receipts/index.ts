/**
 * Receipt reading: the deterministic half.
 *
 * Everything exported here is pure and framework-free, so the same code runs
 * in the browser after a scan and in a unit test against a fixture. The OCR
 * engine itself lives in `src/lib/ocr` — it needs a browser, and nothing in
 * this module does.
 */

export type {
  OcrBox,
  OcrResult,
  OcrTextBox,
  ParsedReceipt,
  ReceiptItem,
  ReceiptLine,
  LineRole,
} from "./types";

export { parseReceiptAmount, findAmounts, hasDecimalPart } from "./amounts";
export type { AmountMatch } from "./amounts";
export { parseReceiptDate } from "./dates";
export { classifyLabel, detectCurrency, foldLabel } from "./labels";
export type { AmountLabel } from "./labels";
export { groupLines, medianLineHeight } from "./lines";
export { parseReceipt } from "./parser";
export type { ParseOptions } from "./parser";
export {
  validateReceipt,
  hasBlockingIssues,
  type ReceiptIssue,
  type ReceiptIssueCode,
  type ReceiptIssueSeverity,
  type ValidationOptions,
} from "./validation";
export {
  assignReceipt,
  buildReceiptSplit,
  toSplitInput,
  ReceiptAssignmentError,
  type AssignmentInput,
  type AssignmentResult,
  type ItemAssignment,
  type ParticipantShare,
  type SharedChargeStrategy,
} from "./assignment";
