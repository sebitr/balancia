import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { getOcrProvider, resetOcrProvider, setOcrProvider } from "./index";

/**
 * Which reader the environment asks for, and whether it gets it.
 *
 * The registry is the one place a credential and a model name turn into an
 * outbound call, so the mapping is worth pinning: an instance that configured
 * nothing must get nothing — the route 404s on `undefined`, which is what
 * keeps the endpoint from existing at all on an instance that never opted in.
 *
 * `parseEnv` is not enough here. The registry reads the *cached* environment,
 * so both caches have to be cleared together or a test reads the previous
 * test's answer.
 */

/** The whole schema has to parse, not only the settings under test. */
const REQUIRED = {
  DATABASE_URL: "postgres://balancia:secret@localhost:5432/balancia",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef0123456789",
};

const KEYS = [
  ...Object.keys(REQUIRED),
  "RECEIPT_OCR_PROVIDER",
  "RECEIPT_OCR_API_KEY",
  "RECEIPT_OCR_BASE_URL",
  "RECEIPT_OCR_MODEL",
  "RECEIPT_SCANNING",
];

const saved = new Map<string, string | undefined>();

function configure(values: Record<string, string>): void {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, REQUIRED, values);
  resetEnvCache();
  resetOcrProvider();
}

beforeEach(() => {
  for (const key of KEYS) saved.set(key, process.env[key]);
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
  resetOcrProvider();
});

describe("the OCR provider registry", () => {
  it("hands back nothing when none is configured", () => {
    configure({});
    expect(getOcrProvider()).toBeUndefined();
  });

  it("builds the driver the environment names", () => {
    configure({ RECEIPT_OCR_PROVIDER: "anthropic", RECEIPT_OCR_API_KEY: "k" });
    expect(getOcrProvider()?.name).toBe("anthropic");

    configure({
      RECEIPT_OCR_PROVIDER: "mistral",
      RECEIPT_OCR_API_KEY: "k",
    });
    expect(getOcrProvider()?.name).toBe("mistral");

    configure({
      RECEIPT_OCR_PROVIDER: "gemini",
      RECEIPT_OCR_API_KEY: "k",
      RECEIPT_OCR_MODEL: "gemini-3-pro",
    });
    expect(getOcrProvider()?.name).toBe("gemini");
  });

  it("defaults a model only where a vendor owns the name", () => {
    configure({ RECEIPT_OCR_PROVIDER: "anthropic", RECEIPT_OCR_API_KEY: "k" });
    // Anthropic and Mistral publish stable ids, so a default here is a
    // promise this project can keep.
    expect(getOcrProvider()?.model).toBeTruthy();

    configure({
      RECEIPT_OCR_PROVIDER: "openai",
      RECEIPT_OCR_API_KEY: "k",
      RECEIPT_OCR_MODEL: "some-served-model",
    });
    // Whereas an OpenAI-compatible endpoint serves whatever its operator
    // loaded, so the name has to be given — `env.ts` refuses to boot without
    // it rather than 404ing at somebody's first scan.
    expect(getOcrProvider()?.model).toBe("some-served-model");
  });

  it("caches, so a driver is built once per process", () => {
    configure({ RECEIPT_OCR_PROVIDER: "anthropic", RECEIPT_OCR_API_KEY: "k" });
    expect(getOcrProvider()).toBe(getOcrProvider());
  });

  it("lets a test put a fake in front of it", () => {
    configure({});
    const fake = {
      name: "anthropic" as const,
      model: "fake",
      read: async () => {
        throw new Error("not called");
      },
    };
    setOcrProvider(fake);
    expect(getOcrProvider()).toBe(fake);
  });
});
