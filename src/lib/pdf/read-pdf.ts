import type { PDFPageProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { OcrResult } from "@/modules/receipts";
import { MAX_DETECTION_SIDE } from "@/lib/ocr/config";
import {
  hasUsableTextLayer,
  pageTextBoxes,
  stackPages,
  type PdfPageBoxes,
} from "./text-layer";

/**
 * Opening a PDF receipt, and deciding which kind of PDF it is.
 *
 * Two very different files arrive with the same extension. One was produced by
 * a computer and carries its own text; the other is a photograph or a scan
 * wrapped in a page, and carries nothing. The first is read directly and never
 * touches the OCR models — it needs no download, runs in milliseconds, and is
 * exactly right rather than probably right. The second is rendered to pixels
 * and handed to the scanner like any photograph.
 *
 * Which one it is cannot be asked; it has to be tried. So the text layer is
 * always extracted first and `hasUsableTextLayer` decides whether it amounts to
 * a receipt.
 *
 * On the worker
 * -------------
 * pdf.js normally parses in a Web Worker loaded from a URL. It cannot here:
 * its worker is an ES module, and Turbopack strips `type: "module"` from
 * `new Worker(new URL(...))` — the same wall that made the OCR worker a Blob
 * built from source text (see `src/lib/ocr/worker-source.ts`). Rather than
 * install a second copy of pdf.js under `public/` just to have a URL to point
 * at, its worker module is imported as an ordinary chunk and registered as
 * pdf.js's main-thread handler.
 *
 * The cost is real and small: a receipt-sized document parses in tens of
 * milliseconds behind a modal that is already showing progress. It would be
 * the wrong trade for the OCR models, which run for seconds; it is the right
 * one here. If a PDF ever arrives big enough to make the page stutter, the fix
 * is to serve the worker from `public/` the way the onnxruntime build is.
 */

/* ------------------------------------------------------------ is it a PDF */

/**
 * How far in the header is looked for.
 *
 * `%PDF-` is normally the first five bytes, but the specification allows
 * leading junk and real files collected from mail gateways have it.
 */
const HEADER_SEARCH_BYTES = 1024;

/** `%PDF-` */
const HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** Whether these bytes open a PDF, whatever the file claims to be. */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, HEADER_SEARCH_BYTES) - HEADER.length;
  for (let start = 0; start <= limit; start += 1) {
    let matched = true;
    for (let offset = 0; offset < HEADER.length; offset += 1) {
      if (bytes[start + offset] !== HEADER[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * Whether this file is a PDF.
 *
 * Decided on the bytes rather than on `file.type`, which is whatever the
 * platform guessed: a drag-and-drop from some mail clients arrives as
 * `application/octet-stream`, and a file renamed `.pdf` is not one.
 */
export async function looksLikePdf(file: Blob): Promise<boolean> {
  const head = await file.slice(0, HEADER_SEARCH_BYTES).arrayBuffer();
  return hasPdfHeader(new Uint8Array(head));
}

/* --------------------------------------------------------------- failures */

export type PdfErrorCode =
  /** Encrypted, and we have no password to offer. */
  | "password"
  /** Not a PDF we can open at all. */
  | "unreadable"
  /** Opened, but there is no page in it. */
  | "empty";

export class PdfError extends Error {
  readonly code: PdfErrorCode;

  constructor(code: PdfErrorCode, message: string) {
    super(message);
    this.name = "PdfError";
    this.code = code;
  }
}

/* ---------------------------------------------------------------- reading */

/**
 * Pages read past the first.
 *
 * A restaurant bill is one page and a hotel folio is three. Past this it is
 * not a receipt, and reading a 400-page statement would hang the tab.
 */
export const MAX_PDF_PAGES = 8;

/**
 * How large a page is rendered when it has to be read as a picture.
 *
 * Matched to the size `prepareImage` would reduce a photograph to anyway, so
 * the page is rasterized once at the resolution the detector works at instead
 * of being drawn large and thrown away. The floor keeps a page from rendering
 * below its own point size, where thin type stops being legible at all; the
 * ceiling stops an unusually small media box from being blown up into a
 * hundred megabytes of canvas.
 */
const MIN_RASTER_SCALE = 1;
const MAX_RASTER_SCALE = 4;

/**
 * Where `scripts/copy-pdf-assets.ts` puts pdf.js's image codecs.
 *
 * Same-origin, so `connect-src 'self'` covers the fetch. Compiling them needs
 * `'wasm-unsafe-eval'`, which this instance already grants — receipt scanning
 * is off without it.
 */
const PDFJS_WASM_PATH = "/pdfjs/";

export type PdfReceipt =
  | {
      /** The document said what it contains; no model was involved. */
      readonly kind: "text";
      readonly result: OcrResult;
      readonly pages: number;
    }
  | {
      /** A scan. Page one, drawn, for the scanner to read as a photograph. */
      readonly kind: "image";
      readonly image: Blob;
      readonly pages: number;
    };

type PdfjsModule = typeof import("pdfjs-dist");

let loading: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  loading ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs"),
    ]);
    // pdf.js looks here before it tries to spawn anything, and runs what it
    // finds on the main thread. The worker module registers itself on import,
    // so this line is really an anchor: it is the only use of `worker`, and
    // without it the import is a side-effect-only one that a bundler is
    // entitled to drop.
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return pdfjs;
  })();
  return loading;
}

function classify(failure: unknown): PdfError {
  if (failure instanceof PdfError) return failure;
  const name = failure instanceof Error ? failure.name : "";
  if (name === "PasswordException") {
    return new PdfError("password", "That PDF is password-protected");
  }
  return new PdfError("unreadable", "That PDF could not be opened");
}

/**
 * Reads a receipt PDF, by whichever of the two routes it needs.
 *
 * The document is opened once and both routes are served from it: `getDocument`
 * takes ownership of the buffer it is given, so a second open would need a
 * second copy of the file.
 */
export async function readPdf(file: Blob): Promise<PdfReceipt> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());

  const task = pdfjs.getDocument({
    data,
    // Where the JBIG2 and JPEG 2000 decoders live. Fetched only when a page
    // actually contains such an image; see `scripts/copy-pdf-assets.ts`.
    wasmUrl: PDFJS_WASM_PATH,
    // A receipt has no reason to reach the network, and a document that tries
    // is a document phoning home. `standardFontDataUrl` and `iccUrl` are left
    // unset for the same reason: both would be fetches, and neither changes
    // what a page *says* — which is all that is read here.
    disableAutoFetch: true,
    disableStream: true,
    // PDFs can carry JavaScript. This one will not be running any.
    enableXfa: false,
  });

  try {
    const document = await task.promise;
    if (document.numPages < 1) {
      throw new PdfError("empty", "That PDF has no pages");
    }

    const count = Math.min(document.numPages, MAX_PDF_PAGES);
    const pages: PdfPageBoxes[] = [];
    for (let number = 1; number <= count; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        pageTextBoxes(
          content.items.filter((item): item is TextItem => "str" in item),
          page.getViewport({ scale: 1 }),
        ),
      );
    }

    const text = stackPages(pages);
    if (hasUsableTextLayer(text)) {
      return { kind: "text", result: text, pages: count };
    }

    return {
      kind: "image",
      image: await rasterizeFirstPage(await document.getPage(1)),
      pages: document.numPages,
    };
  } catch (failure) {
    throw classify(failure);
  } finally {
    await task.destroy();
  }
}

/** Draws a page onto a canvas and hands back the picture of it. */
async function rasterizeFirstPage(page: PDFPageProxy): Promise<Blob> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(
    MAX_RASTER_SCALE,
    Math.max(
      MIN_RASTER_SCALE,
      MAX_DETECTION_SIDE / Math.max(base.width, base.height),
    ),
  );
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));

  try {
    // `background` defaults to white, which matters: a page with no background
    // of its own would otherwise render onto transparent black.
    //
    // `intent: "print"` is not about printers. A "display" render is paced by
    // `requestAnimationFrame`, which stops firing the moment the tab is
    // hidden — so someone who switches apps while a scanned receipt is being
    // read comes back to a scan that never finished and never failed either.
    // The print intent runs the same drawing on microtasks instead, and its
    // other effect is one we want anyway: annotations are flattened into the
    // page, so a filled-in form reads as the values somebody filled in.
    await page.render({ canvas, viewport, intent: "print" }).promise;

    const image = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    if (!image)
      throw new PdfError("unreadable", "That page could not be drawn");
    return image;
  } finally {
    // Release the bitmap now rather than at the collector's convenience; on
    // iOS the collector is often later than the next allocation.
    canvas.width = 0;
    canvas.height = 0;
  }
}
