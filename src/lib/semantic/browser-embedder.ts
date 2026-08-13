import type { Embedder } from "@/modules/categorization";
import { MODEL_ID, probeModelAvailable } from "./config";
import { embedderWorkerSource } from "./worker-source";

/**
 * The browser-side `Embedder`.
 *
 * Lazy in three stages, so an instance without the model does no work at all
 * and an instance with it does the expensive work once:
 *
 *  1. one HEAD request decides whether the model exists;
 *  2. only then is the worker created;
 *  3. only on the first `embed` does the worker fetch the runtime and weights.
 *
 * Every failure resolves to `null` or a rejected promise, never a thrown
 * render: the classifier treats an absent embedder as a supported state.
 */

interface PendingRequest {
  resolve: (vectors: Float32Array[]) => void;
  reject: (error: Error) => void;
}

type WorkerResponse =
  | { id: number; ok: true; vectors: Float32Array[] }
  | { id: number; ok: false; error: string };

/** Nothing here is worth blocking a form on. */
const EMBED_TIMEOUT_MS = 20_000;

class WorkerEmbedder implements Embedder {
  readonly id = MODEL_ID;
  readonly #worker: Worker;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;

  constructor(worker: Worker) {
    this.#worker = worker;
    this.#worker.addEventListener(
      "message",
      (event: MessageEvent<WorkerResponse>) => {
        const request = this.#pending.get(event.data.id);
        if (!request) return;
        this.#pending.delete(event.data.id);
        if (event.data.ok) request.resolve(event.data.vectors);
        else request.reject(new Error(event.data.error));
      },
    );
    this.#worker.addEventListener("error", () => this.#failAll("Worker error"));
  }

  embed(texts: readonly string[]): Promise<readonly Float32Array[]> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error("Embedding timed out"));
      }, EMBED_TIMEOUT_MS);

      this.#pending.set(id, {
        resolve: (vectors) => {
          clearTimeout(timer);
          resolve(vectors);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.#worker.postMessage({ id, texts });
    });
  }

  #failAll(message: string): void {
    for (const [, request] of this.#pending) request.reject(new Error(message));
    this.#pending.clear();
  }
}

let embedder: Promise<Embedder | null> | null = null;

/**
 * The instance's embedder, or `null` when the semantic layer is unavailable —
 * not enabled, files not installed, or no worker support in this browser.
 *
 * Memoized: one worker and one loaded model per tab, however many expense
 * forms are opened.
 */
export function getBrowserEmbedder(): Promise<Embedder | null> {
  embedder ??= createEmbedder();
  return embedder;
}

async function createEmbedder(): Promise<Embedder | null> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return null;
  }
  if (!(await probeModelAvailable())) return null;

  try {
    const blob = new Blob([embedderWorkerSource()], {
      type: "text/javascript",
    });
    // The object URL is kept, not revoked: there is one per tab, and revoking
    // it while the worker is still fetching its own script is a race no
    // browser is obliged to lose gracefully.
    const worker = new Worker(URL.createObjectURL(blob), { type: "module" });
    return new WorkerEmbedder(worker);
  } catch {
    return null;
  }
}
