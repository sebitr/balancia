import { describe, expect, it } from "vitest";
import { transform } from "esbuild";
import { embedderWorkerSource } from "./worker-source";
import { MODEL_ID, RUNTIME_URL, WASM_PATH } from "./config";

/**
 * The worker is source text, so nothing type-checks it. These tests are what
 * stands in for the compiler: it has to parse as a module, and the line that
 * forbids remote model downloads has to be in it.
 */

describe("embedderWorkerSource", () => {
  it("parses as an ES module", async () => {
    await expect(
      transform(embedderWorkerSource(), { loader: "js", format: "esm" }),
    ).resolves.toBeDefined();
  });

  it("carries the configured paths, with no second definition of them", () => {
    const source = embedderWorkerSource();
    expect(source).toContain(RUNTIME_URL);
    expect(source).toContain(MODEL_ID);
    expect(source).toContain(WASM_PATH);
  });

  it("forbids fetching a model from anywhere but this instance", () => {
    expect(embedderWorkerSource()).toContain("allowRemoteModels = false");
  });

  it("names no host but this one", () => {
    // Every URL it uses is a path on this origin. A scheme in here would mean
    // the browser talking to somebody else.
    expect(embedderWorkerSource()).not.toMatch(/https?:\/\//);
  });
});
