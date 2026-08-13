/**
 * Where the optional OCR models live.
 *
 * Same arrangement as the semantic categorization model, for the same reasons:
 * Balancia never downloads a model at runtime from anywhere but this instance,
 * and never calls a hosted inference API. An operator who wants receipt
 * scanning runs `pnpm ocr:install`, which places the files under
 * `public/models` (git-ignored), and sets `RECEIPT_SCANNING=1`.
 *
 * With no files present, `probeOcrAvailable()` fails its one HEAD request, no
 * worker is ever created, and the scan button is not rendered.
 *
 * The runtime path is deliberately shared with `src/lib/semantic/config.ts`:
 * both features run on onnxruntime-web, and an instance that installs both
 * downloads the 23 MB WebAssembly binary once.
 */

/** Served from `public/models`, so same-origin and covered by `'self'`. */
export const MODEL_BASE_PATH = "/models";

/** onnxruntime-web's ESM API bundle: WebGPU and WebAssembly in one build. */
export const RUNTIME_URL = `${MODEL_BASE_PATH}/runtime/ort/ort.webgpu.min.mjs`;

/** Directory the runtime loads its `.wasm` and glue `.mjs` from. */
export const WASM_PATH = `${MODEL_BASE_PATH}/runtime/ort/`;

export const OCR_MODEL_PATH = `${MODEL_BASE_PATH}/ocr`;

/** PP-OCRv5 mobile text *detection* — finds the boxes. */
export const DET_MODEL_URL = `${OCR_MODEL_PATH}/ppocrv5-mobile-det.onnx`;

/** PP-OCRv5 mobile text *recognition* — reads each box. */
export const REC_MODEL_URL = `${OCR_MODEL_PATH}/ppocrv5-mobile-rec.onnx`;

/** The recognizer's character list, one character per line. */
export const DICT_URL = `${OCR_MODEL_PATH}/ppocrv5_dict.txt`;

/**
 * Roughly what a first scan downloads, for the "this will take a moment"
 * notice. Approximate on purpose — the exact figure depends on the server's
 * compression, and a precise-looking number that is wrong is worse than a
 * round one that is right.
 */
export const APPROXIMATE_DOWNLOAD_MB = 47;

/** One file that must exist for the feature to work at all. */
const PROBE_URL = DET_MODEL_URL;

/**
 * Cheap existence check, so an instance without the models pays one HEAD
 * request and never loads a worker or a runtime.
 */
export async function probeOcrAvailable(): Promise<boolean> {
  try {
    const response = await fetch(PROBE_URL, {
      method: "HEAD",
      cache: "force-cache",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- geometry */

/**
 * Longest side an image is reduced to before detection.
 *
 * A current phone photographs a receipt at 12 megapixels. Normalizing that at
 * full resolution would allocate about 150 MB of float32 for the detector's
 * input alone, which is how an iOS tab gets killed rather than slowed. The
 * detector was trained around this scale, so the reduction costs no accuracy
 * that matters on printed receipts.
 */
export const MAX_DETECTION_SIDE = 960;

/** The detector's input must be a multiple of this on both axes. */
export const DETECTION_STRIDE = 32;

/** Height every recognizer crop is scaled to. */
export const RECOGNITION_HEIGHT = 48;

/** Widest recognizer crop; anything longer is squeezed to fit. */
export const RECOGNITION_MAX_WIDTH = 480;
