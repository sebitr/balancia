import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ITALIAN_TRATTORIA,
  buildOcrResult,
} from "@/modules/receipts/test-fixtures";

/**
 * What the remote reader does with a PDF.
 *
 * The on-device reader learned to read PDFs before this one existed, which
 * left a trap: pick "on this device" and an emailed invoice is read, pick a
 * provider and the same file is rejected as "not a readable image". The two
 * readers have to accept the same files, so the remote one triages a PDF the
 * same way — and the interesting half of that is what it does *not* do.
 *
 * A PDF carrying its own text is answered on the device and never uploaded.
 * That is a privacy claim and a billing claim at once, so it is asserted as
 * `fetch` never having been called, rather than as the right answer coming
 * back by some route.
 */

const { looksLikePdf, readPdf } = vi.hoisted(() => ({
  looksLikePdf: vi.fn<(file: Blob) => Promise<boolean>>(),
  readPdf: vi.fn(),
}));

vi.mock("@/lib/pdf/read-pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pdf/read-pdf")>()),
  looksLikePdf,
  readPdf,
}));

const { RemoteReader } = await import("./reader");

/** What pdf.js's text layer hands back, in the shape the parser expects. */
const textLayer = buildOcrResult(ITALIAN_TRATTORIA);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  looksLikePdf.mockReset();
  readPdf.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the remote reader, given a PDF", () => {
  it("answers a text PDF here, and uploads nothing", async () => {
    looksLikePdf.mockResolvedValue(true);
    readPdf.mockResolvedValue({ kind: "text", result: textLayer, pages: 1 });

    const reader = new RemoteReader("group-1", "EUR");
    const receipt = await reader.read(new Blob(["%PDF-1.7"]));

    expect(fetchMock).not.toHaveBeenCalled();
    // Read from the document's own text, so it is exact rather than close.
    expect(receipt.total).toBe(4620n);
    expect(receipt.merchant).toBe("Trattoria da Vinci");
  });

  it("uploads the drawn page when the PDF is a scan", async () => {
    const drawn = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    looksLikePdf.mockResolvedValue(true);
    readPdf.mockResolvedValue({ kind: "image", image: drawn, pages: 1 });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ receipt: { currency: "EUR", items: [] } })),
    );

    const reader = new RemoteReader("group-1", "EUR");
    await reader.read(new Blob(["%PDF-1.7"]));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    // The page that was drawn, not the PDF it was drawn from.
    expect(await (body.get("file") as File).arrayBuffer()).toEqual(
      await drawn.arrayBuffer(),
    );
  });

  it("reports a locked PDF as locked, not as a provider failure", async () => {
    const { PdfError } = await import("@/lib/pdf/read-pdf");
    looksLikePdf.mockResolvedValue(true);
    readPdf.mockRejectedValue(new PdfError("password", "locked"));

    const reader = new RemoteReader("group-1", "EUR");

    await expect(reader.read(new Blob(["%PDF-1.7"]))).rejects.toMatchObject({
      code: "pdfPassword",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves a photograph alone", async () => {
    looksLikePdf.mockResolvedValue(false);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ receipt: { currency: "EUR", items: [] } })),
    );

    const reader = new RemoteReader("group-1", "EUR");
    await reader.read(new Blob([new Uint8Array([0xff, 0xd8])]));

    expect(readPdf).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
