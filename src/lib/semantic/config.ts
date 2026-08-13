/**
 * Where the optional embedding model lives.
 *
 * Balancia never downloads a model at runtime and never calls a hosted
 * inference API. If an operator wants the semantic layer, they place the
 * files under `public/models` (see `scripts/fetch-semantic-model.ts`) and set
 * `SEMANTIC_CATEGORIZATION=1`. Everything is then served by this instance,
 * from this origin, and the browser does the inference.
 *
 * With no files present, `probeModelAvailable()` fails its one HEAD request
 * and the classifier stays purely deterministic — which is the default.
 */

/** Served from `public/models`, so same-origin and covered by `'self'`. */
export const MODEL_BASE_PATH = "/models";

/**
 * Multilingual sentence encoder, ONNX build for Transformers.js. Handles
 * English and French in one vector space, so neither is translated first.
 */
export const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

/** The Transformers.js ESM bundle, also served from this instance. */
export const RUNTIME_URL = `${MODEL_BASE_PATH}/runtime/transformers.min.js`;

/** onnxruntime-web's `.wasm` binaries. */
export const WASM_PATH = `${MODEL_BASE_PATH}/runtime/ort/`;

/** Quantized weights: a quarter of the size, no meaningful loss for ranking. */
export const MODEL_DTYPE = "q8";

/** One file that must exist for the model to be usable at all. */
export const MODEL_PROBE_URL = `${MODEL_BASE_PATH}/${MODEL_ID}/config.json`;

/**
 * Cheap existence check, so an instance without the model pays one HEAD
 * request and never loads a worker, a runtime or a tokenizer.
 */
export async function probeModelAvailable(): Promise<boolean> {
  try {
    const response = await fetch(MODEL_PROBE_URL, {
      method: "HEAD",
      cache: "force-cache",
    });
    return response.ok;
  } catch {
    return false;
  }
}
