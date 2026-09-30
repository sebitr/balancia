/**
 * @vitest-environment jsdom
 *
 * The redraw needs a `document` to make a canvas in. jsdom has one, but no
 * decoder and no encoder, so both are stood in for below: what is under test
 * is which files are redrawn, at what size, and what happens when a step
 * fails — not the browser's JPEG codec.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareReceiptForUpload, RECEIPT_MAX_EDGE } from "./receipt-image";
import { uploadReceipt } from "./upload-receipt";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78]);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
const HEIC = new Uint8Array([
  0x00,
  0x00,
  0x00,
  0x18,
  ...new TextEncoder().encode("ftypheic"),
  0x00,
  0x00,
  0x00,
  0x00,
]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = new TextEncoder().encode("%PDF-1.7\n");

/** What the fake encoder hands back: clean bytes, nothing like the input. */
const REDRAWN = new Blob(["redrawn"], { type: "image/jpeg" });

let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
let context: {
  fillStyle: string;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
};
let encoded: Blob | null;
let canvasSize: { width: number; height: number } | null;

beforeEach(() => {
  bitmap = { width: 4032, height: 3024, close: vi.fn() };
  context = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
  };
  encoded = REDRAWN;
  canvasSize = null;

  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
  ) {
    canvasSize = { width: this.width, height: this.height };
    callback(encoded);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("redrawing a receipt photograph", () => {
  it("redraws a JPEG, orientation applied, as a fresh JPEG", async () => {
    const original = new File([JPEG], "IMG_2041.jpeg", { type: "image/jpeg" });

    const prepared = await prepareReceiptForUpload(original, original.name);

    expect(prepared.file).toBe(REDRAWN);
    expect(prepared.fileName).toBe("IMG_2041.jpg");
    expect(createImageBitmap).toHaveBeenCalledWith(original, {
      imageOrientation: "from-image",
    });
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      expect.any(Number),
    );
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("caps the long edge, keeping the proportions", async () => {
    await prepareReceiptForUpload(new Blob([JPEG]), "a.jpg");

    expect(canvasSize).toEqual({ width: RECEIPT_MAX_EDGE, height: 1920 });
    expect(context.drawImage).toHaveBeenCalledWith(
      bitmap,
      0,
      0,
      RECEIPT_MAX_EDGE,
      1920,
    );
  });

  it("never scales a small photo up", async () => {
    bitmap = { width: 900, height: 1600, close: vi.fn() };

    await prepareReceiptForUpload(new Blob([JPEG]), "a.jpg");

    expect(canvasSize).toEqual({ width: 900, height: 1600 });
  });

  it("puts transparent pixels on white rather than black", async () => {
    await prepareReceiptForUpload(new Blob([WEBP]), "a.webp");

    expect(context.fillStyle).toBe("#ffffff");
    expect(context.fillRect).toHaveBeenCalled();
    expect(context.fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      context.drawImage.mock.invocationCallOrder[0],
    );
  });

  it("recognises the file by its bytes, not its name or its type", async () => {
    // Shared in from another app with no type and a misleading name.
    const prepared = await prepareReceiptForUpload(
      new Blob([HEIC]),
      "IMG_2041.HEIC",
    );

    expect(prepared.file).toBe(REDRAWN);
    expect(prepared.fileName).toBe("IMG_2041.jpg");
  });

  it.each([
    ["a PDF", PDF, "bill.pdf"],
    ["a PNG", PNG, "screenshot.png"],
  ])("sends %s exactly as it was", async (_, bytes, name) => {
    const original = new Blob([bytes]);

    const prepared = await prepareReceiptForUpload(original, name);

    expect(prepared.file).toBe(original);
    expect(prepared.fileName).toBe(name);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("sends the original when the browser cannot decode it", async () => {
    // HEIC anywhere but Safari, or a Safari too old for the options bag.
    vi.mocked(createImageBitmap).mockRejectedValueOnce(
      new DOMException("unsupported", "InvalidStateError"),
    );
    const original = new Blob([HEIC]);

    const prepared = await prepareReceiptForUpload(original, "IMG.HEIC");

    expect(prepared.file).toBe(original);
    expect(prepared.fileName).toBe("IMG.HEIC");
  });

  it("sends the original when the canvas will not encode", async () => {
    encoded = null;
    const original = new Blob([JPEG]);

    const prepared = await prepareReceiptForUpload(original, "a.jpg");

    expect(prepared.file).toBe(original);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("sends the original when the canvas cannot write JPEG at all", async () => {
    encoded = new Blob(["png"], { type: "image/png" });
    const original = new Blob([JPEG]);

    const prepared = await prepareReceiptForUpload(original, "a.jpg");

    expect(prepared.file).toBe(original);
  });

  it("sends the original when there is no canvas to draw on", async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const original = new Blob([JPEG]);

    const prepared = await prepareReceiptForUpload(original, "a.jpg");

    expect(prepared.file).toBe(original);
    expect(bitmap.close).toHaveBeenCalled();
  });
});

describe("the upload", () => {
  it("sends the redrawn photograph, not the one that was picked", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ id: "a1", fileName: "IMG_2041.jpg" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const picked = new File([JPEG], "IMG_2041.JPG", { type: "image/jpeg" });
    const result = await uploadReceipt("g1", picked, picked.name);

    expect(result.ok).toBe(true);
    const init = fetchMock.mock.calls[0]?.[1];
    const sent = (init?.body as FormData).get("file") as File;
    expect(sent.name).toBe("IMG_2041.jpg");
    expect(await sent.text()).toBe("redrawn");
  });
});
