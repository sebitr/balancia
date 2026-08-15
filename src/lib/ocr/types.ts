/**
 * What a receipt reader is, whichever one is doing the reading.
 *
 * Split out of `scanner.ts` when a second reader arrived: the WebAssembly
 * engine and the server-side provider report the same progress, fail with the
 * same codes, and produce the same `ParsedReceipt`, so the dialog does not
 * have to know which one it was handed.
 */
import type { ParsedReceipt } from "@/modules/receipts";

/** What the user is waiting for. Reported honestly; see `stage` below. */
export type ScanStage =
  | "preparing"
  | "downloading"
  | "uploading"
  | "detecting"
  | "reading"
  | "analyzing";

export interface ScanProgress {
  readonly stage: ScanStage;
  /** Regions read, or bytes downloaded — only when they can be counted. */
  readonly done?: number;
  readonly total?: number;
  /**
   * Bytes of the file currently downloading. Reported per file rather than as
   * one figure across the whole install, because the runtime's own
   * WebAssembly is fetched by onnxruntime and cannot be counted here — a
   * combined percentage would be wrong by whatever that weighs.
   */
  readonly fileLoaded?: number;
  readonly fileTotal?: number;
}

/**
 * Where the reading happened.
 *
 * `remote` is deliberately one value rather than one per provider: the
 * interface says which provider in words the operator configured, and the
 * code only ever needs to know whether the image left the device.
 */
export type ScanBackend = "webgpu" | "wasm" | "remote" | "unknown";

/** Machine-readable failures, so the UI can say something specific. */
export type ScanErrorCode =
  | "unsupported"
  | "unavailable"
  | "modelDownload"
  | "runtime"
  | "image"
  | "timeout"
  /** Encrypted. Nothing to do about it here — the reader must unlock it. */
  | "pdfPassword"
  /** Damaged, or not really a PDF at all. */
  | "pdf"
  /** The reader is configured but refused or could not be reached. */
  | "provider";

export class ScanError extends Error {
  readonly code: ScanErrorCode;

  constructor(code: ScanErrorCode, message: string) {
    super(message);
    this.name = "ScanError";
    this.code = code;
  }
}

/**
 * Which reader read a receipt.
 *
 * Named rather than boolean because it reaches the interface: "on this
 * device" and "with Claude" are different promises to the person scanning,
 * and the copy has to be able to tell them apart.
 */
export type ReaderKind = "local" | "remote";

/**
 * A receipt reader.
 *
 * Returns a `ParsedReceipt` rather than an `OcrResult`, because only one of
 * the two readers produces text boxes. Whichever it is, what comes out goes
 * through `validateReceipt` and then in front of a person.
 */
export interface ReceiptReader {
  readonly kind: ReaderKind;
  read(
    file: Blob,
    onProgress?: (progress: ScanProgress) => void,
  ): Promise<ParsedReceipt>;
  /** Releases anything expensive the reader is holding. */
  dispose(): void;
}
