import type { OcrResult } from "@/modules/receipts";
import { looksLikePdf, PdfError, readPdf } from "@/lib/pdf/read-pdf";
import { prepareImage } from "./preprocess";
import { ocrWorkerSource } from "./worker-source";
import {
  ScanError,
  type ScanBackend,
  type ScanProgress,
  type ScanStage,
} from "./types";

/**
 * The page's handle on the OCR worker.
 *
 * Lazy in the same three stages as the semantic embedder, so an instance
 * without the models does no work at all and an instance with them does the
 * expensive work once:
 *
 *  1. one HEAD request decides whether the models exist;
 *  2. only then is the worker created;
 *  3. only on the first scan does the worker fetch the runtime and weights.
 *
 * The scanner is *not* memoized across the tab the way the embedder is. The
 * models occupy a few hundred megabytes of runtime memory once compiled, and
 * scanning a receipt is something someone does occasionally rather than on
 * every keystroke — so the worker is created for a scanning session and
 * terminated when the dialog closes.
 */

interface WorkerReady {
  readonly type: "ready";
  readonly backend: ScanBackend;
}
interface WorkerProgress {
  readonly type: "progress";
  readonly stage: Exclude<ScanStage, "analyzing">;
  readonly done?: number;
  readonly total?: number;
  readonly fileLoaded?: number;
  readonly fileTotal?: number;
}
interface WorkerResult {
  readonly type: "result";
  readonly id: number;
  readonly result: OcrResult;
  readonly backend: ScanBackend;
}
interface WorkerFailure {
  readonly type: "error";
  readonly id?: number;
  readonly message: string;
}

type WorkerResponse =
  WorkerReady | WorkerProgress | WorkerResult | WorkerFailure;

/**
 * A scan can legitimately take a while on a slow phone the first time, when it
 * is also downloading tens of megabytes. After this, something has gone wrong that no
 * amount of further waiting fixes.
 */
const SCAN_TIMEOUT_MS = 180_000;

/** Whether this browser could run the scanner at all. */
export function isScanningSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof WebAssembly !== "undefined" &&
    typeof createImageBitmap === "function"
  );
}

export class ReceiptScanner {
  #worker: Worker | null = null;
  #objectUrl: string | null = null;
  #nextId = 1;
  #backend: ScanBackend = "unknown";

  /** Which execution provider the last scan actually ran on. */
  get backend(): ScanBackend {
    return this.#backend;
  }

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;
    if (!isScanningSupported()) {
      throw new ScanError("unsupported", "This browser cannot run the scanner");
    }

    try {
      const blob = new Blob([ocrWorkerSource()], { type: "text/javascript" });
      this.#objectUrl = URL.createObjectURL(blob);
      this.#worker = new Worker(this.#objectUrl, { type: "module" });
      return this.#worker;
    } catch {
      throw new ScanError("runtime", "The scanner worker could not start");
    }
  }

  /**
   * Reads a receipt.
   *
   * The image is reduced on the main thread — the browser's own decoder is the
   * fastest thing available and it has to happen somewhere — and only its
   * pixels cross into the worker, transferred rather than copied.
   *
   * A PDF takes a detour first. If it carries its own text — an emailed
   * invoice, a train ticket — that text *is* the answer, and this returns
   * before the worker is ever created: no models, no WebAssembly, no
   * recognition error. If it does not, its first page becomes a picture and
   * carries on below as though it had been photographed.
   */
  async scan(
    file: Blob,
    onProgress?: (progress: ScanProgress) => void,
  ): Promise<OcrResult> {
    onProgress?.({ stage: "preparing" });

    let source = file;
    if (await looksLikePdf(file)) {
      const content = await readPdf(file).catch((failure: unknown) => {
        throw classifyPdf(failure);
      });

      if (content.kind === "text") {
        onProgress?.({ stage: "analyzing" });
        return content.result;
      }
      source = content.image;
    }

    let prepared;
    try {
      prepared = await prepareImage(source);
    } catch {
      throw new ScanError("image", "That image could not be read");
    }

    const worker = this.#ensureWorker();
    const id = this.#nextId++;

    return new Promise<OcrResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new ScanError("timeout", "Reading the receipt timed out"));
      }, SCAN_TIMEOUT_MS);

      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;

        if (message.type === "progress") {
          onProgress?.({
            stage: message.stage,
            done: message.done,
            total: message.total,
            fileLoaded: message.fileLoaded,
            fileTotal: message.fileTotal,
          });
          return;
        }

        if (message.type === "result" && message.id === id) {
          this.#backend = message.backend;
          cleanup();
          onProgress?.({ stage: "analyzing" });
          resolve(message.result);
          return;
        }

        if (
          message.type === "error" &&
          (message.id === id || message.id === undefined)
        ) {
          cleanup();
          reject(classify(message.message));
        }
      };

      const onError = () => {
        cleanup();
        reject(new ScanError("runtime", "The scanner stopped unexpectedly"));
      };

      const cleanup = () => {
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);

      worker.postMessage(
        {
          type: "scan",
          id,
          // The worker is built from a Blob and cannot resolve a path against
          // its own `blob:` location, so it is told where it is running.
          origin: window.location.origin,
          buffer: prepared.buffer,
          width: prepared.width,
          height: prepared.height,
        },
        // Transfer: the pixel buffer is handed over, not duplicated.
        [prepared.buffer],
      );
    });
  }

  /**
   * Releases the worker and everything it compiled.
   *
   * Worth being deliberate about: two ONNX sessions and a WebAssembly instance
   * are hundreds of megabytes, and a phone that keeps them alive behind a
   * closed dialog will drop the tab the next time the camera opens.
   */
  dispose(): void {
    this.#worker?.terminate();
    this.#worker = null;
    if (this.#objectUrl) {
      URL.revokeObjectURL(this.#objectUrl);
      this.#objectUrl = null;
    }
  }
}

/** Maps a PDF failure onto something the UI can explain. */
function classifyPdf(failure: unknown): ScanError {
  if (failure instanceof PdfError && failure.code === "password") {
    return new ScanError("pdfPassword", failure.message);
  }
  return new ScanError(
    "pdf",
    failure instanceof Error ? failure.message : "That PDF could not be read",
  );
}

/** Maps the worker's message onto something the UI can explain. */
function classify(message: string): ScanError {
  if (/download failed|dictionary failed|status \d+/i.test(message)) {
    return new ScanError("modelDownload", message);
  }
  return new ScanError("runtime", message);
}
