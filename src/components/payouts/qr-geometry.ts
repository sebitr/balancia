/**
 * The parts of a payment code that are geometry rather than markup.
 *
 * A code is drawn twice now: as SVG on the settle screen, where it is held up
 * to a camera, and onto a canvas when it is attached to a reminder as a
 * picture. Those are two renderers of one drawing, and the quiet zone and the
 * Swiss cross are the two places where getting them subtly out of step would
 * produce a code that scans in one place and not the other.
 */

/**
 * A quiet zone of four modules is part of the QR specification, not padding: a
 * reader is entitled to assume it, and a code drawn tight to the edge of a dark
 * surface is one that sometimes will not scan.
 */
export const QR_QUIET_MODULES = 4;

/** One rectangle of the drawing, in the code's own module units. */
export interface QrRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly dark: boolean;
}

/**
 * The Swiss recognition symbol, which the guidelines make part of the code.
 *
 * "The Swiss QR Code created for printout is overlaid with a cross logo in
 * black and white, measuring 7 x 7 mm" — on the 46 mm code the payment part
 * specifies, so a shade over 15% of the side, expressed as a ratio rather than
 * a pixel count so it holds at any size.
 *
 * It covers real modules. That is what the M error-correction level is for, and
 * it is why this is only ever drawn over a code encoded at M rather than at L.
 *
 * The white keyline is part of the logo: without it the black square merges
 * into whatever modules happen to sit under its edge.
 */
export function swissCrossRects(side: number): readonly QrRect[] {
  const size = side * (7 / 46);
  const origin = (side - size) / 2;
  const inset = size * 0.06;
  const arm = size * 0.18;
  const reach = size * 0.62;
  const centre = side / 2;

  return [
    { x: origin, y: origin, width: size, height: size, dark: false },
    {
      x: origin + inset,
      y: origin + inset,
      width: size - inset * 2,
      height: size - inset * 2,
      dark: true,
    },
    {
      x: centre - arm / 2,
      y: centre - reach / 2,
      width: arm,
      height: reach,
      dark: false,
    },
    {
      x: centre - reach / 2,
      y: centre - arm / 2,
      width: reach,
      height: arm,
      dark: false,
    },
  ];
}
