/**
 * The configured server-side reader, if the operator configured one.
 *
 * Same shape as `getStorage()` in `src/lib/storage`: built once per process
 * from the environment, with a setter so tests can put a fake in front of it
 * and never touch a network.
 *
 * `undefined` is the ordinary case. Receipt scanning works without a provider
 * — that is what the browser's own reader is for — so every caller has to
 * handle its absence rather than assuming one is configured.
 */
import { getEnv } from "@/lib/env";
import { AnthropicOcrProvider } from "./anthropic";
import { GeminiOcrProvider } from "./gemini";
import { MistralOcrProvider } from "./mistral";
import { OpenAiOcrProvider } from "./openai";
import type { OcrProvider } from "./types";

export * from "./types";
export { RECEIPT_INSTRUCTIONS, toParsedReceipt } from "./reply";

let provider: OcrProvider | undefined;
let resolved = false;

/** The configured provider, or `undefined` when there is none. */
export function getOcrProvider(): OcrProvider | undefined {
  if (resolved) return provider;
  const env = getEnv();

  const options = {
    apiKey: env.RECEIPT_OCR_API_KEY,
    baseUrl: env.RECEIPT_OCR_BASE_URL,
    model: env.RECEIPT_OCR_MODEL,
  };

  switch (env.RECEIPT_OCR_PROVIDER) {
    case "anthropic":
      provider = new AnthropicOcrProvider(options);
      break;
    case "openai":
      // `env.ts` refuses to start without a model for these two, so the
      // assertion is a type narrowing rather than a hope.
      provider = new OpenAiOcrProvider({
        ...options,
        model: options.model as string,
      });
      break;
    case "gemini":
      provider = new GeminiOcrProvider({
        ...options,
        model: options.model as string,
      });
      break;
    case "mistral":
      provider = new MistralOcrProvider(options);
      break;
    default:
      provider = undefined;
  }

  resolved = true;
  return provider;
}

/** Test hook, matching `setStorageDriver`. */
export function setOcrProvider(next: OcrProvider | undefined): void {
  provider = next;
  resolved = true;
}

/** Test hook: forget the cached provider so the environment is read again. */
export function resetOcrProvider(): void {
  provider = undefined;
  resolved = false;
}
