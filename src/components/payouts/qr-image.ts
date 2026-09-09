"use client";

import { encode } from "uqr";
import type { PaymentQrStandard } from "@/modules/payouts/qr/payment-qr";
import { QR_QUIET_MODULES, swissCrossRects } from "./qr-geometry";

/**
 * A payment code as a file, for the share sheet to hand to a chat app.
 *
 * The settle screen draws its codes as SVG because they are held up to a
 * camera and an SVG stays sharp at any size. A code that travels cannot be an
 * SVG: `navigator.share` carries files, chat apps show PNGs and JPEGs, and
 * nothing in that chain renders vector markup as a picture. So the same matrix
 * is drawn a second time onto a canvas — from `qr-geometry`, so the two
 * drawings cannot drift apart.
 *
 * ## Why a picture at all
 *
 * Two of the six standards have no text form. An EPC payload is eleven
 * newline-separated lines and a Swiss one is thirty-odd; pasted into a chat
 * they are gibberish, and pasted into a banking app they are nothing. The
 * Girocode *is* the image, which is why the feature this belongs to would have
 * missed most of Europe without it.
 *
 * Returning null is ordinary: a browser with no canvas, a `toBlob` that
 * refuses. The message still carries its line of text, which is what the
 * caller falls back to.
 */

/** Pixels per module. 8 puts a typical payment code near 400px square. */
const MODULE_PX = 8;

/**
 * The longest side worth sending.
 *
 * A Swiss payload is dense enough to reach version 15 or so, and at eight
 * pixels a module that is a 1000px image for something a camera reads at a
 * glance. Scaling the module down instead keeps the file small without ever
 * dropping below the whole-pixel edges `crispEdges` buys the SVG.
 */
const MAX_SIDE_PX = 720;

export async function paymentCodeFile(
  payload: string,
  standard: PaymentQrStandard | null,
  filename: string,
): Promise<File | null> {
  if (typeof document === "undefined") return null;

  const matrix = encode(payload, { ecc: "M", border: 0 });
  const side = matrix.size + QR_QUIET_MODULES * 2;
  // Whole pixels per module, never fewer than one: a fractional module is a
  // blurred edge, and a blurred edge is a code a camera hunts for.
  const scale = Math.max(
    1,
    Math.min(MODULE_PX, Math.floor(MAX_SIDE_PX / side)),
  );

  const canvas = document.createElement("canvas");
  canvas.width = side * scale;
  canvas.height = side * scale;
  // A context is not guaranteed: a browser refusing canvas, and jsdom under
  // the component tests, both answer null here — and jsdom answers it by
  // throwing. Either way the caller falls back to the line of text.
  const context = (() => {
    try {
      return canvas.getContext("2d");
    } catch {
      return null;
    }
  })();
  if (!context) return null;

  // White first, and the whole surface: a transparent PNG on a chat app's dark
  // bubble is a code with no quiet zone and inverted modules.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "#000000";
  matrix.data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      context.fillRect(
        (x + QR_QUIET_MODULES) * scale,
        (y + QR_QUIET_MODULES) * scale,
        scale,
        scale,
      );
    }),
  );

  if (standard === "swiss") {
    for (const rect of swissCrossRects(side * scale)) {
      context.fillStyle = rect.dark ? "#000000" : "#ffffff";
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) return null;

  return new File([blob], filename, { type: "image/png" });
}
