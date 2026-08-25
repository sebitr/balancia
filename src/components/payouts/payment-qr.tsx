"use client";

import { useMemo } from "react";
import { encode } from "uqr";
import type { PaymentQrStandard } from "@/modules/payouts/qr/payment-qr";

/**
 * A payment code, drawn from its payload.
 *
 * The matrix is encoded here rather than shipped as an image: it is a few
 * hundred booleans, it costs nothing to draw as SVG, and an SVG stays sharp on
 * a phone held up to another phone — which is exactly how one of these gets
 * scanned in a restaurant.
 *
 * **Error correction is fixed at M** for both standards. Neither leaves it to
 * taste: the EPC guidelines specify M, and the Swiss one relies on it, because
 * the Swiss cross sits on top of the middle of the code and something has to
 * pay for the modules it covers.
 *
 * Rendered in plain black and white, not in the app's palette. A payment code
 * is read by a camera under a restaurant's lighting, and the contrast it needs
 * is not a design decision.
 */
export function PaymentQr({
  payload,
  standard,
  label,
}: {
  payload: string;
  standard: PaymentQrStandard;
  /** What a screen reader is told this is; the code itself is decoration. */
  label: string;
}) {
  const matrix = useMemo(
    () => encode(payload, { ecc: "M", border: 0 }),
    [payload],
  );

  // A quiet zone of four modules is part of the QR specification, not padding:
  // a reader is entitled to assume it, and a code drawn tight to the edge of a
  // dark surface is one that sometimes will not scan.
  const quiet = 4;
  const side = matrix.size + quiet * 2;

  return (
    <svg
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      aria-label={label}
      className="h-auto w-full max-w-64 rounded-lg"
      shapeRendering="crispEdges"
    >
      <rect width={side} height={side} fill="#ffffff" />
      {matrix.data.map((row, y) =>
        row.map((dark, x) =>
          dark ? (
            <rect
              key={`${x}-${y}`}
              x={x + quiet}
              y={y + quiet}
              width={1}
              height={1}
              fill="#000000"
            />
          ) : null,
        ),
      )}
      {standard === "swiss" && <SwissCross side={side} />}
    </svg>
  );
}

/**
 * The recognition symbol, which the guidelines make part of the code.
 *
 * "The Swiss QR Code created for printout is overlaid with a cross logo in
 * black and white, measuring 7 x 7 mm" — on the 46 mm code the payment part
 * specifies, so a shade over 15% of the side, drawn to that ratio rather than
 * to a pixel count so it holds at any size.
 *
 * It covers real modules. That is what the M error-correction level is for,
 * and it is why this is drawn over a code encoded at M rather than at L.
 */
function SwissCross({ side }: { side: number }) {
  const size = side * (7 / 46);
  const origin = (side - size) / 2;
  // The white keyline is part of the logo: without it the black square merges
  // into whatever modules happen to sit under its edge.
  const inset = size * 0.06;
  const arm = size * 0.18;
  const reach = size * 0.62;
  const centre = side / 2;

  return (
    <g aria-hidden="true">
      <rect x={origin} y={origin} width={size} height={size} fill="#ffffff" />
      <rect
        x={origin + inset}
        y={origin + inset}
        width={size - inset * 2}
        height={size - inset * 2}
        fill="#000000"
      />
      <rect
        x={centre - arm / 2}
        y={centre - reach / 2}
        width={arm}
        height={reach}
        fill="#ffffff"
      />
      <rect
        x={centre - reach / 2}
        y={centre - arm / 2}
        width={reach}
        height={arm}
        fill="#ffffff"
      />
    </g>
  );
}
