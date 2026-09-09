"use client";

import { useMemo } from "react";
import { encode } from "uqr";
import type { PaymentQrStandard } from "@/modules/payouts/qr/payment-qr";
import { QR_QUIET_MODULES, swissCrossRects } from "./qr-geometry";

/**
 * A payment code, drawn from its payload.
 *
 * The matrix is encoded here rather than shipped as an image: it is a few
 * hundred booleans, it costs nothing to draw as SVG, and an SVG stays sharp on
 * a phone held up to another phone — which is exactly how one of these gets
 * scanned in a restaurant.
 *
 * **Error correction is fixed at M** for every standard here. The two SEPA
 * ones do not leave it to taste: the EPC guidelines specify M, and the Swiss
 * one relies on it, because the Swiss cross sits on top of the middle of the
 * code and something has to pay for the modules it covers. The rest are M
 * because that is the level their own specifications assume, and because a
 * code held up to another phone is read in one go or not at all — the higher
 * levels buy resilience against a printed code being scuffed, which is not the
 * failure this one meets.
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
  /**
   * Which standard drew it, or null when the payload is an ordinary link being
   * handed to a phone rather than a scheme's own code.
   */
  standard: PaymentQrStandard | null;
  /** What a screen reader is told this is; the code itself is decoration. */
  label: string;
}) {
  const matrix = useMemo(
    () => encode(payload, { ecc: "M", border: 0 }),
    [payload],
  );

  const quiet = QR_QUIET_MODULES;
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

/** The recognition symbol, drawn from the shared geometry in `qr-geometry`. */
function SwissCross({ side }: { side: number }) {
  return (
    <g aria-hidden="true">
      {swissCrossRects(side).map((rect, index) => (
        <rect
          key={index}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill={rect.dark ? "#000000" : "#ffffff"}
        />
      ))}
    </g>
  );
}
