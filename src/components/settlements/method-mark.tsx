"use client";

import { useState } from "react";
import { Banknote, Landmark } from "lucide-react";
import type { PaymentMethod } from "@/modules/settlements/payment-methods";

/**
 * A payment method's mark.
 *
 * Balancia ships no provider artwork: the marks belong to their owners, and a
 * trademark licence does not survive being redistributed by every fork of an
 * AGPL repository. So the default is a lettermark on the brand's own hue,
 * which reads as "a payment app" without pretending to be an official asset.
 *
 * An operator who *does* have the right to display a provider's logo drops it
 * into `public/payment-methods/<id>.svg` and it appears here instead. That
 * file never enters the repository, which is the whole point — see the README
 * in that directory.
 *
 * The lettermark is painted first and the logo is layered over it, revealed
 * only once it has actually loaded. Nothing has to know in advance which files
 * an operator supplied: a missing one simply never reveals itself, so there is
 * no probe, no manifest to keep in step, and no broken-image frame.
 *
 * Cash and bank transfer are drawn glyphs — neither is a brand.
 *
 * A method somebody named themselves has no brand at all, so it takes the
 * app's own surface rather than a hue invented for it: still a tile, still the
 * initial, and honestly not one of ours.
 *
 * It lives here rather than beside the picker that first needed it because the
 * settle screen's chip row draws the same tile at a smaller size. Two of these
 * would be two answers to "did the operator supply a logo", and the second one
 * to be written is the one that forgets the fallback.
 *
 * `unbranded` is how cash and bank transfer are drawn, and it is the one thing
 * that differs between the two places this appears. Beside a sentence about
 * paying somebody, a banknote and a bank say what they are faster than any
 * word. In a *column* of tiles — the payout list, the picker — a loose glyph
 * among tiles reads as a missing tile, so there the initial takes the app's own
 * surface instead: still not a brand, still honestly not one of ours.
 */
export function MethodMark({
  method,
  label,
  size = 22,
  unbranded = "glyph",
}: {
  /** The listed method, or null for a name typed on the settle screen. */
  method: PaymentMethod | null;
  label: string;
  size?: number;
  /** How cash and bank transfer are drawn. See the note above. */
  unbranded?: "glyph" | "tile";
}) {
  const [logoLoaded, setLogoLoaded] = useState(false);
  const radius = size / 3.4;

  const neutral = (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center bg-wash-3 font-semibold text-foreground shadow-hairline-inset"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: size * 0.5,
      }}
    >
      {label.trim().charAt(0).toUpperCase()}
    </span>
  );

  // A name somebody typed has no brand at all, whichever way it is asked for.
  if (method === null) return neutral;

  if (method.kind === "cash" || method.kind === "bank") {
    if (unbranded === "tile") return neutral;
    return method.kind === "cash" ? (
      <Banknote aria-hidden="true" className="size-5 shrink-0" />
    ) : (
      <Landmark aria-hidden="true" className="size-5 shrink-0" />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="relative flex shrink-0 items-center justify-center font-semibold shadow-hairline-inset"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: size * 0.5,
        // The tile's own colour is dropped once a logo covers it: a supplied
        // mark brings its own background, and the brand hue behind it would
        // only fight with it.
        background: logoLoaded ? "transparent" : method.brandColor,
        color: method.onBrand === "dark" ? "oklch(0.226 0.072 319)" : "#fff",
      }}
    >
      {!logoLoaded && label.charAt(0).toUpperCase()}
      {/* eslint-disable-next-line @next/next/no-img-element -- an operator drops
          these in at runtime, so there is nothing for the image optimiser to
          resolve at build time, and a 404 must stay silent. */}
      <img
        src={`/payment-methods/${method.id}.svg`}
        alt=""
        onLoad={() => setLogoLoaded(true)}
        className="absolute inset-0 size-full object-contain"
        style={{ borderRadius: radius, opacity: logoLoaded ? 1 : 0 }}
      />
    </span>
  );
}
