/**
 * The bit of every driver that is not the provider's own JSON.
 *
 * Three things matter here and none of them is interesting enough to write
 * three times: a request that cannot hang forever, a response that cannot
 * exhaust memory, and an error that says what went wrong without quoting the
 * receipt back into the logs.
 */
import { OcrProviderError, classifyStatus } from "./types";
import type { OcrProviderName } from "./types";

/**
 * Longest a single read may take.
 *
 * Someone is watching a spinner, and a vision model that has not answered in
 * this long is not about to. The route applies its own signal too; whichever
 * fires first wins.
 */
export const READ_TIMEOUT_MS = 60_000;

/**
 * Most a reply may weigh.
 *
 * A receipt's worth of JSON is a few kilobytes. This is three orders of
 * magnitude of headroom and still bounded, so a provider having a bad day
 * cannot stream an unlimited body into this process.
 */
const MAX_REPLY_BYTES = 2_000_000;

/** Combines the caller's signal, if any, with our own deadline. */
function withDeadline(signal: AbortSignal | undefined): {
  readonly signal: AbortSignal;
  readonly done: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);

  const forward = () => controller.abort();
  signal?.addEventListener("abort", forward, { once: true });
  if (signal?.aborted) controller.abort();

  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    },
  };
}

/**
 * Reads a bounded amount of text from a response.
 *
 * `response.text()` will happily buffer whatever arrives. This stops at the
 * cap and abandons the rest rather than letting a provider decide how much
 * memory this process uses.
 */
async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REPLY_BYTES) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return chunks.join("") + decoder.decode();
}

/**
 * POSTs JSON and returns the parsed reply, or throws an `OcrProviderError`.
 *
 * The provider's own error body is deliberately not included in the thrown
 * message: it is attacker-influenced in the sense that it can echo request
 * content, and request content here is a receipt. The status is enough to say
 * whose problem it is.
 */
export async function postJson(
  provider: OcrProviderName,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const deadline = withDeadline(signal);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: deadline.signal,
      // No cookies, no redirects to somewhere we did not mean to send a photo.
      credentials: "omit",
      redirect: "error",
    });
  } catch (error) {
    deadline.done();
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new OcrProviderError(
      provider,
      aborted ? "timeout" : "response",
      aborted
        ? "The reader did not answer in time"
        : "The reader could not be reached",
    );
  }

  try {
    if (!response.ok) {
      throw new OcrProviderError(
        provider,
        classifyStatus(response.status),
        `The reader answered ${response.status}`,
      );
    }

    const raw = await readCapped(response);
    try {
      return JSON.parse(raw);
    } catch {
      throw new OcrProviderError(
        provider,
        "response",
        "The reader's answer was not JSON",
      );
    }
  } finally {
    deadline.done();
  }
}
