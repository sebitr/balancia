import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { ScanReceiptDialog } from "./scan-receipt-dialog";
import type { ParsedReceipt } from "@/modules/receipts";

/**
 * What the scanner promises about getting *out* of it.
 *
 * The dialog only ever exists because a receipt is on its way in, so every
 * way of not having one any more has to end with the dialog gone and the form
 * underneath back in front of the reader. These tests are that: cancel, a scan
 * that reads nothing, and a scan that throws.
 */

const read = vi.fn();
const dispose = vi.fn();
const toastError = vi.fn();
let liveCamera = true;

vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

vi.mock("@/lib/doc-scan/engine", () => ({
  isLiveCameraSupported: () => liveCamera,
}));

vi.mock("@/lib/pdf/read-pdf", () => ({ looksLikePdf: async () => false }));

vi.mock("@/modules/telemetry/actions", () => ({
  recordReceiptScanAction: async () => undefined,
}));

vi.mock("@/lib/ocr/reader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ocr/reader")>();
  return {
    ...actual,
    createReader: () => ({ read, dispose }),
  };
});

/**
 * The live camera, reduced to the three things it can tell the dialog.
 *
 * The real one wants getUserMedia and a canvas; what is under test is what
 * happens to the dialog afterwards, so the buttons stand in for the gestures.
 */
vi.mock("./document-camera", () => ({
  DocumentCamera: ({
    onCapture,
    onCancel,
    onFallback,
  }: {
    onCapture: (file: File) => void;
    onCancel: () => void;
    onFallback: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onCapture(photo())}>
        shutter
      </button>
      <button type="button" onClick={onCancel}>
        cancel camera
      </button>
      <button type="button" onClick={onFallback}>
        fall back
      </button>
    </div>
  ),
}));

function photo(): File {
  return new File(["jpeg"], "receipt.jpg", { type: "image/jpeg" });
}

const RECOGNISED: ParsedReceipt = {
  merchant: "Casa Italia",
  date: "2026-08-13",
  currency: "EUR",
  items: [{ id: "i1", name: "Margherita", total: 1900n, confidence: 0.98 }],
  subtotal: 1900n,
  tax: 0n,
  total: 1900n,
};

const NOTHING: ParsedReceipt = {
  merchant: "",
  date: "",
  currency: "EUR",
  items: [],
  subtotal: undefined,
  tax: undefined,
  total: undefined,
};

function renderScanner() {
  const onApply = vi.fn();
  const view = renderWithIntl(
    <ScanReceiptDialog
      groupId="g1"
      localAvailable
      participants={[
        { id: "p1", displayName: "Seb" },
        { id: "p2", displayName: "Cyril" },
      ]}
      defaultCurrency="EUR"
      onApply={onApply}
    />,
  );
  return { ...view, onApply };
}

const dialog = () => screen.queryByRole("dialog");

beforeEach(() => {
  read.mockReset();
  dispose.mockReset();
  toastError.mockReset();
  liveCamera = true;
});

describe("ScanReceiptDialog", () => {
  it("offers the two pickers directly, opening nothing in between", async () => {
    renderScanner();

    // Both actions are on the form itself. Neither is a door onto a screen
    // that asks which of them you meant.
    expect(
      screen.getByRole("button", { name: "Take a photo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Choose a photo or PDF" }),
    ).toBeInTheDocument();
    expect(dialog()).not.toBeInTheDocument();
  });

  it("closes when the camera is cancelled, rather than falling back to a chooser", async () => {
    const user = userEvent.setup();
    renderScanner();

    await user.click(screen.getByRole("button", { name: "Take a photo" }));
    expect(dialog()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "cancel camera" }));

    // Gone entirely — the form behind it is what the reader wanted back.
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: "Take a photo" }),
    ).toBeInTheDocument();
  });

  it("closes and says why when the scan reads nothing", async () => {
    const user = userEvent.setup();
    read.mockResolvedValue(NOTHING);
    renderScanner();

    await user.click(screen.getByRole("button", { name: "Take a photo" }));
    await user.click(screen.getByRole("button", { name: "shutter" }));

    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toMatch(/No receipt text was found/);
  });

  it("closes and says why when the scan fails outright", async () => {
    const user = userEvent.setup();
    read.mockRejectedValue(new Error("boom"));
    renderScanner();

    await user.click(screen.getByRole("button", { name: "Take a photo" }));
    await user.click(screen.getByRole("button", { name: "shutter" }));

    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("goes on to the review when the scan finds something", async () => {
    const user = userEvent.setup();
    read.mockResolvedValue(RECOGNISED);
    renderScanner();

    await user.click(screen.getByRole("button", { name: "Take a photo" }));
    await user.click(screen.getByRole("button", { name: "shutter" }));

    await waitFor(() =>
      expect(screen.getByDisplayValue("Casa Italia")).toBeInTheDocument(),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("sends another photo back to the camera it was taken with", async () => {
    const user = userEvent.setup();
    read.mockResolvedValue(RECOGNISED);
    renderScanner();

    await user.click(screen.getByRole("button", { name: "Take a photo" }));
    await user.click(screen.getByRole("button", { name: "shutter" }));
    await waitFor(() =>
      expect(screen.getByDisplayValue("Casa Italia")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Try another photo" }));

    // Straight back behind the lens — not to a screen asking camera or file.
    expect(screen.getByRole("button", { name: "shutter" })).toBeInTheDocument();
  });

  it("closes on the way out to the platform camera picker", async () => {
    const user = userEvent.setup();
    renderScanner();

    await user.click(screen.getByRole("button", { name: "Take a photo" }));
    await user.click(screen.getByRole("button", { name: "fall back" }));

    // The picker is a native surface with nothing behind it worth dimming.
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
  });
});
