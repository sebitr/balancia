import {
  MODEL_BASE_PATH,
  MODEL_DTYPE,
  MODEL_ID,
  RUNTIME_URL,
  WASM_PATH,
} from "./config";

/**
 * The embedding worker, as source text rather than a module.
 *
 * This is deliberate, and it is the one place in Balancia where code is a
 * string. Two reasons:
 *
 *  - **The worker must be a *module* worker.** Its whole job is one dynamic
 *    `import()` of a runtime this instance serves, and dynamic import is only
 *    universally available in module workers. Turbopack's `new Worker(new
 *    URL(...))` handling strips the `type` option and produces a *classic*
 *    worker, so a bundled worker file cannot guarantee what this needs. Built
 *    here and handed to `new Worker(blobUrl, { type: "module" })`, the type is
 *    ours to choose. `worker-src 'self' blob:` already allows it.
 *
 *  - **Nothing about Transformers.js may reach the bundle.** The library and
 *    its WebAssembly runtime are tens of megabytes and most instances never
 *    install them. Keeping the import out of the module graph means an
 *    instance that does not use the feature carries not one byte of it, and
 *    has none of its supply-chain surface.
 *
 * Every configuration value is interpolated from `config.ts`, so the paths
 * still have exactly one definition.
 */

/** Keeps peak memory bounded when the ~120 prototypes are embedded at once. */
const BATCH_SIZE = 32;

export function embedderWorkerSource(): string {
  const constants = {
    runtimeUrl: RUNTIME_URL,
    modelId: MODEL_ID,
    modelPath: `${MODEL_BASE_PATH}/`,
    wasmPath: WASM_PATH,
    dtype: MODEL_DTYPE,
    batchSize: BATCH_SIZE,
  };

  return `
const CONFIG = ${JSON.stringify(constants)};

let extractor = null;

async function loadExtractor() {
  const transformers = await import(CONFIG.runtimeUrl);

  transformers.env.allowLocalModels = true;
  // The one line that guarantees no model is ever fetched from a third party.
  transformers.env.allowRemoteModels = false;
  transformers.env.localModelPath = CONFIG.modelPath;
  transformers.env.backends.onnx.wasm.wasmPaths = CONFIG.wasmPath;

  return transformers.pipeline("feature-extraction", CONFIG.modelId, {
    dtype: CONFIG.dtype,
  });
}

async function embed(texts) {
  extractor ??= loadExtractor();
  const pipe = await extractor;

  const vectors = [];
  for (let start = 0; start < texts.length; start += CONFIG.batchSize) {
    const batch = texts.slice(start, start + CONFIG.batchSize);
    const output = await pipe(batch, { pooling: "mean", normalize: true });
    const width = output.dims[output.dims.length - 1] ?? 0;
    if (width === 0) throw new Error("Embedding model returned no dimensions");
    for (let i = 0; i < batch.length; i += 1) {
      vectors.push(output.data.slice(i * width, (i + 1) * width));
    }
  }
  return vectors;
}

self.addEventListener("message", (event) => {
  const { id, texts } = event.data;
  embed(texts).then(
    (vectors) => {
      // Transfer rather than copy: loading the prototypes moves ~1 MB at once.
      self.postMessage(
        { id, ok: true, vectors },
        vectors.map((vector) => vector.buffer),
      );
    },
    (error) => {
      self.postMessage({
        id,
        ok: false,
        error: error instanceof Error ? error.message : "Embedding failed",
      });
    },
  );
});
`;
}
