/**
 * Reads a receipt with Claude.
 *
 * Raw HTTP rather than `@anthropic-ai/sdk`, and deliberately: this driver is
 * one of three behind `OcrProvider`, and Balancia ships no vendor SDK for any
 * of them. Three of them in the image, for a feature that is off by default,
 * is a cost every operator would pay and almost none would use. The request
 * below is the documented Messages API shape and nothing more.
 */
import {
  OcrProviderError,
  type OcrProvider,
  type OcrReadOptions,
} from "./types";
import { postJson } from "./http";
import {
  RECEIPT_INSTRUCTIONS,
  RECEIPT_JSON_SCHEMA,
  extractJson,
  receiptReplySchema,
  toParsedReceipt,
} from "./reply";
import type { ParsedReceipt } from "@/modules/receipts";

const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

/**
 * Thinking is on by default on this model and shares the budget with the
 * answer, so the ceiling has to cover both. A receipt's JSON is a couple of
 * kilobytes; the rest is headroom for reading a bad photograph.
 */
const MAX_TOKENS = 16_000;

/** What Claude accepts, and what `file-type` will have told us we have. */
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

interface AnthropicReply {
  readonly content?: readonly {
    readonly type: string;
    readonly text?: string;
  }[];
  readonly stop_reason?: string;
}

export class AnthropicOcrProvider implements OcrProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;

  constructor(options: {
    readonly apiKey?: string;
    readonly baseUrl?: string;
    readonly model?: string;
  }) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.#apiKey = options.apiKey ?? "";
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async read(
    image: Buffer,
    contentType: string,
    options: OcrReadOptions,
  ): Promise<ParsedReceipt> {
    if (!IMAGE_TYPES.has(contentType)) {
      throw new OcrProviderError(
        this.name,
        "response",
        "That image format cannot be read by this provider",
      );
    }

    const body = {
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: RECEIPT_INSTRUCTIONS,
      output_config: {
        // A bounded extraction, not an open problem. Low effort reads a
        // receipt as well as high does and costs a fraction of it.
        effort: "low",
        format: { type: "json_schema", schema: RECEIPT_JSON_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: contentType,
                data: image.toString("base64"),
              },
            },
            { type: "text", text: "Read this receipt." },
          ],
        },
      ],
    };

    const reply = (await postJson(
      this.name,
      `${this.#baseUrl}/v1/messages`,
      {
        "x-api-key": this.#apiKey,
        "anthropic-version": API_VERSION,
      },
      body,
      options.signal,
    )) as AnthropicReply;

    /*
     * A refusal arrives as a successful response with an empty or partial
     * body, so `content` has to be checked against `stop_reason` rather than
     * indexed straight into. Nothing here should trip a classifier — it is a
     * photograph of a shop receipt — but a reader that assumes that and reads
     * `content[0]` fails with a type error rather than a message.
     */
    if (reply.stop_reason === "refusal") {
      throw new OcrProviderError(
        this.name,
        "response",
        "The reader declined to read that image",
      );
    }

    const text = (reply.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");

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
