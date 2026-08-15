/**
 * Reads a receipt with Mistral's dedicated OCR endpoint.
 *
 * The odd one out among the drivers, and worth having for it. The other three
 * post a chat completion to a general vision model; this posts a document to
 * `/v1/ocr`, which is a purpose-built document reader rather than a
 * conversational model that can also see. It is priced per page rather than
 * per token, which makes an operator's bill predictable in a way token
 * pricing is not.
 *
 * The endpoint's own output is markdown per page, which is no use here — a
 * receipt has to arrive as fields, not prose. What makes it fit is the
 * annotation format: given a JSON Schema it returns an object shaped to it,
 * so it can be handed the same `RECEIPT_JSON_SCHEMA` the Anthropic driver
 * uses and its answer goes through the same `toParsedReceipt`.
 */
import {
  OcrProviderError,
  type OcrProvider,
  type OcrReadOptions,
} from "./types";
import { postJson } from "./http";
import {
  RECEIPT_JSON_SCHEMA,
  extractJson,
  receiptReplySchema,
  toParsedReceipt,
} from "./reply";
import type { ParsedReceipt } from "@/modules/receipts";

const DEFAULT_BASE_URL = "https://api.mistral.ai/v1";

/**
 * A rolling alias rather than a pinned version, and deliberately: this is the
 * one endpoint of the four whose model name is a stable product identifier
 * rather than a version that moves. `RECEIPT_OCR_MODEL` overrides it.
 */
const DEFAULT_MODEL = "mistral-ocr-latest";

interface OcrReply {
  /** The schema-shaped answer. A JSON string on the wire, not an object. */
  readonly document_annotation?: string | null;
}

export class MistralOcrProvider implements OcrProvider {
  readonly name = "mistral" as const;
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
    const body = {
      model: this.model,
      document: {
        type: "image_url",
        image_url: `data:${contentType};base64,${image.toString("base64")}`,
      },
      // Annotate the document as a whole. The per-box variant exists too, but
      // a receipt is one object, not a page of separately-labelled figures.
      document_annotation_format: {
        type: "json_schema",
        json_schema: {
          name: "receipt",
          schema: RECEIPT_JSON_SCHEMA,
          strict: true,
        },
      },
    };

    const reply = (await postJson(
      this.name,
      `${this.#baseUrl}/ocr`,
      { authorization: `Bearer ${this.#apiKey}` },
      body,
      options.signal,
    )) as OcrReply;

    const annotation = reply.document_annotation;
    if (typeof annotation !== "string" || annotation.trim() === "") {
      /*
       * Without the annotation there is only page markdown, and there is no
       * path from markdown to a `ParsedReceipt` — the deterministic parser
       * works on positioned boxes, which this endpoint does not return in a
       * form it could use. Failing here is honest; the user can retry on the
       * other reader.
       */
      throw new OcrProviderError(
        this.name,
        "response",
        "The reader returned no structured receipt",
      );
    }

    const parsed = receiptReplySchema.safeParse(extractJson(annotation));
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
