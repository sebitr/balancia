import { describe, expect, it } from "vitest";
import { fileKindOf, fileSizeOf } from "./file-meta";

describe("fileKindOf", () => {
  it("names a picture of a receipt a picture, whatever encoded it", () => {
    expect(fileKindOf("image/jpeg")).toBe("image");
    expect(fileKindOf("image/png")).toBe("image");
    expect(fileKindOf("image/heic")).toBe("image");
  });

  it("names a PDF a PDF", () => {
    expect(fileKindOf("application/pdf")).toBe("pdf");
  });

  it("falls back rather than reading a subtype out loud", () => {
    expect(fileKindOf("application/octet-stream")).toBe("file");
    expect(fileKindOf("text/csv")).toBe("file");
  });
});

describe("fileSizeOf", () => {
  it("reads a small file in kilobytes", () => {
    expect(fileSizeOf(142_000n)).toEqual({ unit: "kilobytes", size: 142 });
  });

  it("never rounds a real file down to nothing", () => {
    // 420 bytes is 0.42 kB, and "0 kB" reads as a failed upload.
    expect(fileSizeOf(420n)).toEqual({ unit: "kilobytes", size: 1 });
  });

  it("switches to megabytes at a megabyte, not before", () => {
    expect(fileSizeOf(999_000n)).toEqual({ unit: "kilobytes", size: 999 });
    expect(fileSizeOf(1_000_000n)).toEqual({ unit: "megabytes", size: 1 });
  });

  it("keeps one decimal place above a megabyte", () => {
    expect(fileSizeOf(1_420_000n)).toEqual({ unit: "megabytes", size: 1.4 });
    expect(fileSizeOf(12_340_000n)).toEqual({ unit: "megabytes", size: 12.3 });
  });
});
