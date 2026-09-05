import { formatOklch, oklchToHex, type Oklch } from "@/lib/color/oklch";

/**
 * The dark surface: how the page is lit at night, as opposed to which colour
 * it is accented with.
 *
 * The theme decides light or dark and lives in the browser (`next-themes`).
 * This refines the dark half of it — Plum as drawn, or Midnight, which takes
 * the same palette down to where an OLED panel goes black. Like the theme it
 * belongs to the device rather than the account: the phone that wants
 * Midnight for its panel is not the laptop it syncs with. So it is a cookie,
 * read by the server and written onto `<html>` as a data attribute, and
 * nothing is stored on the account or sent to the phone app.
 *
 * A cookie rather than local storage, for the same reason the accent is: an
 * attribute the server did not write is one the first paint does not have,
 * and a page that flashes plum before it settles on midnight is worse than
 * one that takes a moment to follow you to a new device.
 *
 * The default is the absence of an attribute, so a document nobody painted —
 * a test, the design-system kit — is the cream-and-plum one.
 *
 * There were two more settings here. A light surface (Cream or Paper) went
 * because a warmer or a cooler white is a preference with nothing behind it,
 * unlike a battery. A contrast choice went because it was a worse copy of a
 * setting the reader already has: increased contrast now follows
 * `prefers-contrast: more` from a media query in `globals.css`, with no
 * cookie and no pre-paint script to keep in step with it.
 */

export const DARK_SURFACES = ["plum", "midnight"] as const;

export type DarkSurface = (typeof DARK_SURFACES)[number];

/** The light palette is no longer a choice, but it still has a swatch. */
export type Surface = "cream" | DarkSurface;

export const SURFACE_COOKIE_NAMES = {
  dark: "balancia_dark",
} as const;

export interface SurfacePreferences {
  readonly dark: DarkSurface;
}

export const DEFAULT_SURFACES: SurfacePreferences = {
  dark: "plum",
};

export function isDarkSurface(value: unknown): value is DarkSurface {
  return (DARK_SURFACES as readonly unknown[]).includes(value);
}

/** Whatever was stored, as a full set of choices — unknown means default. */
export function resolveSurfaces(stored: {
  dark?: unknown;
}): SurfacePreferences {
  return {
    dark: isDarkSurface(stored.dark) ? stored.dark : DEFAULT_SURFACES.dark,
  };
}

/**
 * The attributes `<html>` carries, with the default left off.
 *
 * `globals.css` reacts to `data-dark="midnight"` and to nothing else; a
 * document with no attribute is the palette as drawn.
 */
export function surfaceAttributes(
  preferences: SurfacePreferences,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (preferences.dark !== DEFAULT_SURFACES.dark) {
    attributes["data-dark"] = preferences.dark;
  }
  return attributes;
}

/**
 * The ground and the card of each surface, for the drawn preview cards and
 * for the browser chrome (`theme-color`).
 *
 * These are the same values the blocks in `globals.css` carry —
 * `src/modules/profile/surface.test.ts` checks that they still match. Cream
 * is here although it cannot be chosen: the theme cards draw it, and it is
 * what tints the browser chrome in the light theme.
 */
export const SURFACE_SWATCHES: Record<Surface, { ground: Oklch; bar: Oklch }> =
  {
    cream: {
      ground: { l: 0.977, c: 0.007, h: 85 },
      bar: { l: 1, c: 0, h: 0 },
    },
    plum: {
      ground: { l: 0.226, c: 0.072, h: 319 },
      bar: { l: 0.32, c: 0.07, h: 319 },
    },
    midnight: {
      ground: { l: 0.15, c: 0.03, h: 319 },
      bar: { l: 0.24, c: 0.04, h: 319 },
    },
  };

/** The swatch as CSS colours. */
export function swatchCss(surface: Surface): { ground: string; bar: string } {
  const swatch = SURFACE_SWATCHES[surface];
  return { ground: formatOklch(swatch.ground), bar: formatOklch(swatch.bar) };
}

/** What the browser chrome is tinted with on this surface. */
export function themeColorFor(surface: Surface): string {
  return oklchToHex(SURFACE_SWATCHES[surface].ground).toLowerCase();
}
