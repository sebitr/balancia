/**
 * Picking a reader, and talking to whichever one was picked.
 *
 * Two implementations of one interface:
 *
 *  - `LocalReader` runs PP-OCRv5 in a worker on this device and parses the
 *    boxes it finds. The image does not leave the page.
 *  - `RemoteReader` posts the image to this instance, which forwards it to
 *    the provider the operator configured and returns what it read.
 *
 * The choice is the user's, per scan, and the default is local wherever local
 * is possible. Nothing here decides silently: the dialog shows which reader
 * is selected and what it means before the shutter is pressed.
 */
import { parseReceipt, type ParsedReceipt } from "@/modules/receipts";
import { probeOcrAvailable } from "./config";
import { ReceiptScanner, isScanningSupported } from "./scanner";
import { deserializeParsedReceipt } from "./serialize";
import {
  ScanError,
  type ReaderKind,
  type ReceiptReader,
  type ScanProgress,
} from "./types";

export * from "./types";
export { isScanningSupported } from "./scanner";

/** Wraps the on-device engine so it returns a receipt rather than boxes. */
export class LocalReader implements ReceiptReader {
  readonly kind = "local" as const;
  #scanner: ReceiptScanner | null = null;
  readonly #fallbackCurrency: string;

  constructor(fallbackCurrency: string) {
    this.#fallbackCurrency = fallbackCurrency;
  }

  async read(
    file: Blob,
    onProgress?: (progress: ScanProgress) => void,
  ): Promise<ParsedReceipt> {
    this.#scanner ??= new ReceiptScanner();
    const result = await this.#scanner.scan(file, onProgress);
    onProgress?.({ stage: "analyzing" });
    return parseReceipt(result, { fallbackCurrency: this.#fallbackCurrency });
  }

  /** Two ONNX sessions are hundreds of megabytes; do not keep them around. */
  dispose(): void {
    this.#scanner?.dispose();
    this.#scanner = null;
  }
}

/**
 * Posts the image to this instance and lets it do the reading.
 *
 * Nothing is held between scans, so `dispose` has nothing to release — the
 * method exists because the interface has it and the dialog calls it without
 * asking which reader it got.
 */
export class RemoteReader implements ReceiptReader {
  readonly kind = "remote" as const;
  readonly #groupId: string;
  readonly #fallbackCurrency: string;

  constructor(groupId: string, fallbackCurrency: string) {
    this.#groupId = groupId;
    this.#fallbackCurrency = fallbackCurrency;
  }

  async read(
    file: Blob,
    onProgress?: (progress: ScanProgress) => void,
  ): Promise<ParsedReceipt> {
    onProgress?.({ stage: "uploading" });

    const body = new FormData();
    body.append("file", file, "receipt");
    body.append("currency", this.#fallbackCurrency);

    let response: Response;
    try {
      response = await fetch(
        `/api/groups/${encodeURIComponent(this.#groupId)}/receipt-scan`,
        { method: "POST", body },
      );
    } catch {
      throw new ScanError("provider", "The reader could not be reached");
    }

    if (!response.ok) {
      // The body carries a message meant for a person; the status is what
      // decides whether waiting would help.
      throw new ScanError(
        response.status === 413 || response.status === 400
          ? "image"
          : "provider",
        "The receipt could not be read",
      );
    }

    onProgress?.({ stage: "analyzing" });

    try {
      const payload = (await response.json()) as { receipt?: unknown };
      return deserializeParsedReceipt(payload.receipt);
    } catch {
      throw new ScanError("provider", "The reader's answer could not be read");
    }
  }

  dispose(): void {
    // Nothing to release.
  }
}

/** Builds the reader the user asked for. */
export function createReader(
  kind: ReaderKind,
  options: { readonly groupId: string; readonly fallbackCurrency: string },
): ReceiptReader {
  return kind === "remote"
    ? new RemoteReader(options.groupId, options.fallbackCurrency)
    : new LocalReader(options.fallbackCurrency);
}

/**
 * Whether the on-device reader could run here: the browser supports it and
 * the operator installed the models.
 */
export async function isLocalReadingAvailable(
  localEnabled: boolean,
): Promise<boolean> {
  if (!localEnabled || !isScanningSupported()) return false;
  return probeOcrAvailable();
}
