"use client";

import { useState } from "react";
import { findPaymentMethod } from "@/modules/settlements/payment-methods";

/**
 * A payment method's mark, as a lettermark on the brand's own hue.
 *
 * Balancia ships no provider artwork: the marks belong to their owners, and a
 * trademark licence does not survive being redistributed by every fork of an
 * AGPL repository. So the default is an initial on the brand's colour, which
 * reads as "a payment app" without pretending to be an official asset. An
 * operator who *does* have the right to display one drops it into
 * `public/payment-methods/<id>.svg` and it appears here instead — the same
 * rule, and the same silent 404, as the settle row.
 *
 * Cash, cheques and bank transfers take the app's own surface rather than a
 * hue: none of the three is a brand, and inventing a colour for "Espèces"
 * would put it in a row of logos as though it were one. A method somebody
 * typed themselves gets the same treatment, for the same reason.
 *
 * Sized in pixels rather than by a class because it is drawn at 26 in a row
 * and 30 in the picker, and the radius follows the box: a tile that keeps one
 * radius at both sizes reads as a different shape at each.
 */
export function MethodMark({
  method,
  label,
  size = 26,
}: {
  /** A catalogue id, or a name typed on the picker's free-text row. */
  method: string;
  label: string;
  size?: number;
}) {
  const [logoLoaded, setLogoLoaded] = useState(false);
  const listed = findPaymentMethod(method);
  const branded = listed?.kind === "brand";
  const radius = Math.round(size / 3.25);
  const initial = label.trim().charAt(0).toUpperCase();

  return (
    <span
      aria-hidden="true"
      className="relative flex shrink-0 items-center justify-center font-bold"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.round(size * 0.44),
        // A supplied logo brings its own background, and the brand hue behind
        // it would only fight with it.
        background: branded
          ? logoLoaded
            ? "transparent"
            : listed.brandColor
          : "oklch(1 0 0 / 0.10)",
        color: branded
          ? listed.onBrand === "dark"
            ? "oklch(0.226 0.072 319)"
            : "#fff"
          : undefined,
      }}
    >
      {!(branded && logoLoaded) && initial}
      {branded && (
        /* eslint-disable-next-line @next/next/no-img-element -- an operator
           drops these in at runtime, so there is nothing for the image
           optimiser to resolve at build time, and a 404 must stay silent. */
        <img
          src={`/payment-methods/${listed.id}.svg`}
          alt=""
          onLoad={() => setLogoLoaded(true)}
          className="absolute inset-0 size-full object-contain"
          style={{ borderRadius: radius, opacity: logoLoaded ? 1 : 0 }}
        />
      )}
    </span>
  );
}
