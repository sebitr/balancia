import { type DocumentCorners } from "./geometry";
import { findDocumentCorners } from "./raster";
import { warpPerspective } from "./warp";

/**
 * The scanner engine: the only file in doc-scan that touches a canvas. The
 * detection and warping mathematics live in raster.ts and warp.ts as pure
 * functions over byte arrays; this wraps them for callers that hold video
 * frames in canvases.
 *
 * There is deliberately no OpenCV behind this interface — see raster.ts for
 * why — but the interface would not change if there were, which is the
 * point: the hook, the overlay and the dialog know nothing about how
 * detection works.
 */

export interface DocumentScannerEngine {
  /**
   * Finds the document in a canvas. Returns its corners in that canvas's
   * pixel space, or null when nothing credible is present. Synchronous and
   * CPU-bound — the caller is responsible for not calling it faster than it
   * returns.
   */
  detect(source: HTMLCanvasElement): DocumentCorners | null;
  /**
   * Perspective-corrects the quadrilateral out of `source` into a flat
   * rectangle sized from the document's own geometry, capped at `maxSide`.
   * Returns the source unchanged when the geometry is degenerate.
   */
  extract(
    source: HTMLCanvasElement,
    corners: DocumentCorners,
    maxSide: number,
  ): HTMLCanvasElement;
}

/** Whether a live camera preview is even worth attempting here. */
export function isLiveCameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

let engine: DocumentScannerEngine | null = null;

/**
 * Returns the engine. Async as a matter of interface — detection has no
 * model or runtime to fetch today, but the shape leaves room for one without
 * touching any caller.
 */
export function loadDocumentScanner(): Promise<DocumentScannerEngine> {
  engine ??= { detect, extract };
  return Promise.resolve(engine);
}

function readPixels(source: HTMLCanvasElement): ImageData | null {
  if (source.width === 0 || source.height === 0) return null;
  const context = source.getContext("2d");
  return context?.getImageData(0, 0, source.width, source.height) ?? null;
}

function detect(source: HTMLCanvasElement): DocumentCorners | null {
  const pixels = readPixels(source);
  if (pixels === null) return null;
  return findDocumentCorners(pixels.data, pixels.width, pixels.height);
}

function extract(
  source: HTMLCanvasElement,
  corners: DocumentCorners,
  maxSide: number,
): HTMLCanvasElement {
  const pixels = readPixels(source);
  if (pixels === null) return source;

  const warped = warpPerspective(
    pixels.data,
    { width: pixels.width, height: pixels.height },
    corners,
    maxSide,
  );
  if (warped === null) return source;

  const output = document.createElement("canvas");
  output.width = warped.width;
  output.height = warped.height;
  const context = output.getContext("2d");
  if (!context) return source;
  context.putImageData(
    new ImageData(warped.data, warped.width, warped.height),
    0,
    0,
  );
  return output;
}
