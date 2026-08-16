/**
 * Reads a receipt with any OpenAI-compatible chat-completions endpoint.
 *
 * This is two drivers wearing one coat, and on purpose. The protocol is the
 * one every local inference server speaks, so `RECEIPT_OCR_BASE_URL` pointed
 * at Ollama, vLLM or LM Studio gets an operator a vision model running on
 * their own hardware — no key, no third party, and the receipt never leaves
 * the building. Pointed at a commercial endpoint it is the commercial driver.
 * Balancia does not need to know which it is.
 *
 * There is no default model. Model names on this protocol belong to whoever
 * is serving it — `qwen3-vl` on one operator's Ollama, something else on a
 * hosted API — and a wrong guess is a 404 at the first scan rather than at
 * boot. `RECEIPT_OCR_MODEL` is therefore required, and `env.ts` says so
 * before the app starts.
 */
import {
  OcrProviderError,
  type OcrProvider,
  type OcrReadOptions,
} from "./types";
import { postJson } from "./http";
import {
  RECEIPT_INSTRUCTIONS,
  extractJson,
  receiptReplySchema,
  toParsedReceipt,
} from "./reply";
import type { ParsedReceipt } from "@/modules/receipts";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const MAX_TOKENS = 4_000;

interface ChatReply {
  readonly choices?: readonly {
    readonly message?: { readonly content?: string | null };
  }[];
}

export class OpenAiOcrProvider implements OcrProvider {
  readonly name = "openai" as const;
  readonly model: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;

  constructor(options: {
    readonly apiKey?: string;
    readonly baseUrl?: string;
    readonly model: string;
  }) {
    this.model = options.model;
    this.#apiKey = options.apiKey ?? "";
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async read(
    image: Buffer,
    contentType: string,
    options: OcrReadOptions,
  ): Promise<ParsedReceipt> {
    const body = {
      model: this.model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: RECEIPT_INSTRUCTIONS },
        {
          role: "user",
          content: [
            { type: "text", text: "Read this receipt." },
            {
              type: "image_url",
              image_url: {
                url: `data:${contentType};base64,${image.toString("base64")}`,
              },
            },
          ],
        },
      ],
      /*
       * No `response_format`. It is the one field in this body that a local
       * server may not implement, and a 400 from Ollama would take the
       * feature down for exactly the operator this driver exists to serve.
       * `extractJson` recovers a fenced or prefaced reply instead, which is
       * what the strictness would have bought.
       */
    };

    // A local endpoint usually wants no key at all; sending an empty bearer
    // is worse than sending nothing.
    const headers: Record<string, string> = {};
    if (this.#apiKey) headers.authorization = `Bearer ${this.#apiKey}`;

    const reply = (await postJson(
      this.name,
      `${this.#baseUrl}/chat/completions`,
      headers,
      body,
      options.signal,
    )) as ChatReply;

    const content = reply.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new OcrProviderError(
        this.name,
        "response",
        "The reader returned nothing",
      );
    }

    const parsed = receiptReplySchema.safeParse(extractJson(content));
    if (!parsed.success) {
      throw new OcrProviderError(
        this.name,
        "response",
        "The reader's answer was not a receipt",
      );
    }

    return toParsedReceipt(parsed.data, {
      fallbackCurrency: options.fallbackCurrency,
    });
  }
}
