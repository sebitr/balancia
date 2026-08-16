/**
 * The server-side receipt reader contract.
 *
 * Same arrangement as `src/lib/storage`: one interface, one file per driver,
 * and `index.ts` building whichever the operator configured. A driver is
 * interchangeable with the browser's own reader as far as everything
 * downstream is concerned.
 *
 * The seam is `ParsedReceipt`, not `OcrResult`. A vision model returns
 * structure directly and never produces text boxes; a driver wrapping a
 * classical OCR API would call `parseReceipt()` itself and return the same
 * shape. One return type either way, so the caller never asks which kind of
 * reader it got.
 *
 * What a driver must not do:
 *
 *  - **Trust the model's arithmetic.** Nothing here is authoritative. The
 *    result goes through `validateReceipt()` and then in front of a person,
 *    exactly as the on-device reader's output does, and the shared-charge
 *    residual in `assignment.ts` means an invented tax line cannot corrupt a
 *    split even if nobody reads the warning.
 *  - **Parse amounts itself.** `1.234,50`, `1'234.50` and `12,50` are all
 *    ordinary receipt totals and `parseFloat` is wrong about two of them.
 *    `parseReceiptAmount()` already owns that rule; drivers call it.
 *  - **Log what it read.** A receipt is somebody's dinner, and an error
 *    raised mid-parse can carry fragments of it. Messages only, never bodies.
 */
import type { ParsedReceipt } from "@/modules/receipts";

export type OcrProviderName = "anthropic" | "openai" | "gemini" | "mistral";

export interface OcrReadOptions {
  /** Used only when the receipt names no currency of its own. */
  readonly fallbackCurrency: string;
  /** Abandons the call; the route sets this, not the driver. */
  readonly signal?: AbortSignal;
}

export interface OcrProvider {
  readonly name: OcrProviderName;
  /** The model actually in use, for the operator-facing log line. */
  readonly model: string;
  read(
    image: Buffer,
    contentType: string,
    options: OcrReadOptions,
  ): Promise<ParsedReceipt>;
}

/**
 * Why a read failed, in terms the interface can act on.
 *
 * Deliberately coarse. The person scanning can retry, use the on-device
 * reader, or type the expense by hand, and which of those to suggest is all
 * these codes have to decide.
 */
export type OcrProviderErrorCode =
  /** Rejected our credentials. The operator's problem, not the user's. */
  | "auth"
  /** Provider is rate-limiting or out of quota. Worth retrying later. */
  | "rateLimit"
  /** Took too long, or the connection failed. */
  | "timeout"
  /** Answered, but not with something this driver could read. */
  | "response";

export class OcrProviderError extends Error {
  readonly code: OcrProviderErrorCode;
  readonly provider: OcrProviderName;

  constructor(
    provider: OcrProviderName,
    code: OcrProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OcrProviderError";
    this.provider = provider;
    this.code = code;
  }
}

/** Maps an HTTP status onto one of the codes above. */
export function classifyStatus(status: number): OcrProviderErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rateLimit";
  if (status === 408 || status === 504) return "timeout";
  return "response";
}
