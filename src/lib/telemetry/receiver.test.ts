import { describe, expect, it } from "vitest";
import { flattenPayload } from "./receiver";

/**
 * The fold the collector keeps.
 *
 * Raw payloads are deleted; these pairs are what survives. Every leaf is
 * already a bucket label, an enum member or a boolean, so the fold is lossless
 * and the result still belongs to nobody.
 *
 * The validation and storage halves of the receiver need a database and are
 * covered in `tests/integration/telemetry.test.ts`.
 */

describe("flattenPayload", () => {
  it("turns a nested payload into dotted (field, value) pairs", () => {
    expect(
      flattenPayload({
        schema: 1,
        version: "1.8.2",
        features: { push: true, storage: "local" },
        last7Days: { ocrUses: "6-10", splitMethods: { equal: "26-50" } },
      }),
    ).toEqual([
      ["schema", "1"],
      ["version", "1.8.2"],
      ["features.push", "true"],
      ["features.storage", "local"],
      ["last7Days.ocrUses", "6-10"],
      ["last7Days.splitMethods.equal", "26-50"],
    ]);
  });

  it("keeps booleans as words rather than losing the false ones", () => {
    expect(flattenPayload({ features: { push: false } })).toEqual([
      ["features.push", "false"],
    ]);
  });

  it("skips absent values rather than counting them as something", () => {
    expect(flattenPayload({ a: null, b: undefined, c: "2-5" })).toEqual([
      ["c", "2-5"],
    ]);
  });

  it("produces nothing for an empty payload", () => {
    expect(flattenPayload({})).toEqual([]);
    expect(flattenPayload({ nested: {} })).toEqual([]);
  });
});
