/**
 * The half of the eval harness that has to be in a browser.
 *
 * Everything here runs in the page: a receipt is drawn onto a canvas, encoded
 * as a JPEG the way a phone would hand one over, and put through the *real*
 * `prepareImage` and the *real* OCR worker. Nothing is reimplemented for the
 * benchmark — a harness that measures its own approximation of the pipeline
 * measures nothing.
 *
 * The Node half (`scripts/ocr-eval.ts`) owns the corpus, the scoring and the
 * report, and talks to this through `window.__balanciaOcrEval`.
 */
import { prepareImage } from "../../src/lib/ocr/preprocess";
import { ocrWorkerSource } from "../../src/lib/ocr/worker-source";
import { OCR_MODEL_SETS, type OcrModelKey } from "../../src/lib/ocr/config";
import type { OcrResult } from "../../src/modules/receipts";

/** A fixture line: one box, or a description and an amount in two columns. */
type FixtureLine = string | readonly [string, string];

/**
 * How the photograph was taken.
 *
 * Every one of these is a documented failure of the real feature rather than
 * an invented stress: `dim` is the flat restaurant photograph the contrast
 * stretch exists for, `blur` and `noise` are a phone held slightly wrong in
 * bad light.
 */
type Variant = "clean" | "dim" | "blur" | "noise";

/**
 * The receipt's layout, in the units it is finally *read* at.
 *
 * Everything is multiplied by `CAPTURE_SCALE` before it is drawn. Rendering at
 * the final size instead was the harness's first and worst bug: it laid down
 * 1.5-pixel glyph stems and then JPEG-compressed them, which is a far crueller
 * thing than a camera does. A phone captures twelve megapixels of thick, clean
 * strokes, compresses *that*, and only then is the image reduced — so the
 * ringing lands on detail that is about to be averaged away, and the strokes
 * that reach the detector are soft rather than shattered. Reproducing that
 * order matters more than any other choice in this file.
 */
const WIDTH = 760;
const PADDING = 48;
const LINE_HEIGHT = 34;
const FONT_SIZE = 21;

/** How much larger than the read size the "photograph" is taken. */
const CAPTURE_SCALE = 3;

/** Draws a fixture onto a canvas and returns it as a JPEG, like a camera. */
async function renderReceipt(
  lines: readonly FixtureLine[],
  variant: Variant,
): Promise<Blob> {
  const height = PADDING * 2 + lines.length * LINE_HEIGHT;
  const canvas = new OffscreenCanvas(
    WIDTH * CAPTURE_SCALE,
    height * CAPTURE_SCALE,
  );
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context");

  // Draw in read-size units and let the transform do the enlarging, so the
  // layout below stays readable and the capture stays high-resolution.
  context.scale(CAPTURE_SCALE, CAPTURE_SCALE);

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, WIDTH, height);

  // Applied to the text rather than to the finished bitmap, so the strokes
  // themselves are soft the way an out-of-focus photograph's are.
  if (variant === "blur") context.filter = `blur(${0.8 * CAPTURE_SCALE}px)`;

  context.fillStyle = "#111111";
  context.font = `${FONT_SIZE}px "Courier New", "DejaVu Sans Mono", monospace`;
  context.textBaseline = "top";

  lines.forEach((line, index) => {
    const y = PADDING + index * LINE_HEIGHT;
    if (typeof line === "string") {
      if (line !== "") context.fillText(line, PADDING, y);
      return;
    }
    const [left, right] = line;
    if (left !== "") context.fillText(left, PADDING, y);
    if (right !== "") {
      const width = context.measureText(right).width;
      context.fillText(right, WIDTH - PADDING - width, y);
    }
  });

  context.filter = "none";
  context.resetTransform();

  if (variant === "dim" || variant === "noise") {
    degrade(context, canvas.width, canvas.height, variant);
  }

  // JPEG rather than PNG: it is what a camera roll holds, and it puts the
  // ringing artefacts around the glyph edges that a real scan has to survive.
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
}

/**
 * The two degradations that act on pixels rather than on strokes.
 *
 * `dim` compresses the whole range towards mid grey, which is what a
 * photograph taken in a dim restaurant looks like to the histogram — and it is
 * the case `stretchContrast` was measured against, so a run with this variant
 * exercises the enhancement path rather than bypassing it.
 */
function degrade(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  variant: "dim" | "noise",
): void {
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;

  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = data[index + channel];
      const next =
        variant === "dim"
          ? 128 + (value - 128) * 0.16
          : value + gaussian() * 15;
      data[index + channel] = next < 0 ? 0 : next > 255 ? 255 : next;
    }
  }

  context.putImageData(image, 0, 0);
}

/** Box–Muller, seeded from a counter so two model runs see identical noise. */
let noiseSeed = 1;
function gaussian(): number {
  noiseSeed = (noiseSeed * 1664525 + 1013904223) % 4294967296;
  const first = (noiseSeed + 1) / 4294967297;
  noiseSeed = (noiseSeed * 1664525 + 1013904223) % 4294967296;
  const second = (noiseSeed + 1) / 4294967297;
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

/* ------------------------------------------------------------ the worker */

interface Session {
  readonly worker: Worker;
  backend: string;
}

/**
 * One worker per model set, kept alive across the whole run.
 *
 * Compiling two ONNX graphs takes longer than every scan in the corpus put
 * together, and doing it per receipt would measure the compiler rather than
 * the model.
 */
const sessions = new Map<OcrModelKey, Promise<Session>>();

function startSession(key: OcrModelKey): Promise<Session> {
  const source = ocrWorkerSource(OCR_MODEL_SETS[key]);
  const blob = new Blob([source], { type: "text/javascript" });
  const worker = new Worker(URL.createObjectURL(blob), { type: "module" });

  return new Promise<Session>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "ready") {
        worker.removeEventListener("message", onMessage);
        resolve({ worker, backend: message.backend });
      } else if (message.type === "error") {
        worker.removeEventListener("message", onMessage);
        reject(new Error(message.message));
      }
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({ type: "initialize", origin: location.origin });
  });
}

let nextId = 1;

function scanWith(
  session: Session,
  prepared: {
    buffer: ArrayBuffer;
    width: number;
    height: number;
  },
): Promise<OcrResult> {
  const id = nextId++;
  return new Promise<OcrResult>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "result" && message.id === id) {
        session.worker.removeEventListener("message", onMessage);
        session.backend = message.backend;
        resolve(message.result as OcrResult);
      } else if (message.type === "error" && message.id === id) {
        session.worker.removeEventListener("message", onMessage);
        reject(new Error(message.message));
      }
    };
    session.worker.addEventListener("message", onMessage);
    session.worker.postMessage(
      {
        type: "scan",
        id,
        origin: location.origin,
        buffer: prepared.buffer,
        width: prepared.width,
        height: prepared.height,
      },
      [prepared.buffer],
    );
  });
}

export interface ScanReport {
  readonly result: OcrResult;
  readonly backend: string;
  /** Wall clock inside the worker's scan call, in milliseconds. */
  readonly scanMs: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
}

async function run(
  lines: readonly FixtureLine[],
  variant: Variant,
  key: OcrModelKey,
): Promise<ScanReport> {
  const blob = await renderReceipt(lines, variant);
  const prepared = await prepareImage(blob);
  const width = prepared.width;
  const height = prepared.height;

  let session = sessions.get(key);
  if (!session) {
    session = startSession(key);
    sessions.set(key, session);
  }
  const ready = await session;

  const started = performance.now();
  const result = await scanWith(ready, prepared);
  const scanMs = performance.now() - started;

  return {
    result,
    backend: ready.backend,
    scanMs,
    imageWidth: width,
    imageHeight: height,
  };
}

declare global {
  interface Window {
    __balanciaOcrEval: {
      run: typeof run;
      renderPreview: (
        lines: readonly FixtureLine[],
        variant: Variant,
      ) => Promise<string>;
    };
  }
}

/** A data URL of the rendered receipt, so a run can be looked at, not trusted. */
async function renderPreview(
  lines: readonly FixtureLine[],
  variant: Variant,
): Promise<string> {
  const blob = await renderReceipt(lines, variant);
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

window.__balanciaOcrEval = { run, renderPreview };
