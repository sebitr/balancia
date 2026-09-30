/**
 * The bit of every driver that is not the provider's own JSON.
 *
 * Three things matter here and none of them is interesting enough to write
 * three times: a request that cannot hang forever, a response that cannot
 * exhaust memory, and an error that says what went wrong without quoting the
 * receipt back into the logs.
 */
import { readCapped } from "@/lib/http/read-capped";
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

    // A reply cut off at the cap is not JSON either, and fails as one below.
    const raw = await readCapped(response, MAX_REPLY_BYTES);
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
