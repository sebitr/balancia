/**
 * Reads a receipt with the Gemini generative-language API.
 *
 * As with the OpenAI driver, `RECEIPT_OCR_MODEL` is required rather than
 * defaulted: Gemini's model names carry versions that come and go, and a
 * stale constant here would be a 404 on somebody's first scan. `env.ts`
 * refuses to start without one.
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

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MAX_TOKENS = 4_000;

interface GeminiReply {
  readonly candidates?: readonly {
    readonly content?: {
      readonly parts?: readonly { readonly text?: string }[];
    };
  }[];
}

export class GeminiOcrProvider implements OcrProvider {
  readonly name = "gemini" as const;
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
      systemInstruction: { parts: [{ text: RECEIPT_INSTRUCTIONS }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: "Read this receipt." },
            {
              inlineData: {
                mimeType: contentType,
                data: image.toString("base64"),
              },
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: MAX_TOKENS,
        responseMimeType: "application/json",
      },
    };

    /*
     * The key goes in a header, not the query string: a URL carrying a
     * credential ends up in proxy logs and error messages, and this one is
     * the operator's.
     */
    const reply = (await postJson(
      this.name,
      `${this.#baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
      { "x-goog-api-key": this.#apiKey },
      body,
      options.signal,
    )) as GeminiReply;

    const text = (reply.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");

    if (text.trim() === "") {
      throw new OcrProviderError(
        this.name,
        "response",
        "The reader returned nothing",
      );
    }

    const parsed = receiptReplySchema.safeParse(extractJson(text));
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
