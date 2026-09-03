import { formatOklch, oklchToHex, type Oklch } from "@/lib/color/oklch";

/**
 * Surfaces and contrast: how the page is lit, as opposed to which colour it
 * is accented with.
 *
 * The theme decides light or dark and lives in the browser (`next-themes`).
 * A surface refines it — Cream or Paper by day, Plum or Midnight by night —
 * and the contrast setting pushes captions, lines and inks further from the
 * page for a reader who asked for that, or whose system did. Both are
 * refinements of the theme, and like the theme they belong to the device
 * rather than the account: the phone that wants Midnight for its OLED panel
 * is not the laptop that wants Paper by a window. So they are cookies, read
 * by the server and written onto `<html>` as data attributes, and nothing is
 * stored on the account or sent to the phone app.
 *
 * Cookies rather than local storage, for the same reason the accent is:
 * an attribute the server did not write is one the first paint does not
 * have, and a page that flashes cream before it settles on paper is worse
 * than one that takes a moment to follow you to a new device.
 *
 * The defaults are the absence of an attribute, so a document nobody
 * painted — a test, the design-system kit — is the cream-and-plum one.
 */

export const LIGHT_SURFACES = ["cream", "paper"] as const;
export const DARK_SURFACES = ["plum", "midnight"] as const;
export const CONTRAST_CHOICES = ["auto", "standard", "more"] as const;

export type LightSurface = (typeof LIGHT_SURFACES)[number];
export type DarkSurface = (typeof DARK_SURFACES)[number];
export type Surface = LightSurface | DarkSurface;
export type ContrastChoice = (typeof CONTRAST_CHOICES)[number];

export const SURFACE_COOKIE_NAMES = {
  light: "balancia_light",
  dark: "balancia_dark",
  contrast: "balancia_contrast",
} as const;

export interface SurfacePreferences {
  readonly light: LightSurface;
  readonly dark: DarkSurface;
  readonly contrast: ContrastChoice;
}

export const DEFAULT_SURFACES: SurfacePreferences = {
  light: "cream",
  dark: "plum",
  contrast: "auto",
};

export function isLightSurface(value: unknown): value is LightSurface {
  return (LIGHT_SURFACES as readonly unknown[]).includes(value);
}

export function isDarkSurface(value: unknown): value is DarkSurface {
  return (DARK_SURFACES as readonly unknown[]).includes(value);
}

export function isContrastChoice(value: unknown): value is ContrastChoice {
  return (CONTRAST_CHOICES as readonly unknown[]).includes(value);
}

/** Whatever was stored, as a full set of choices — unknown means default. */
export function resolveSurfaces(stored: {
  light?: unknown;
  dark?: unknown;
  contrast?: unknown;
}): SurfacePreferences {
  return {
    light: isLightSurface(stored.light) ? stored.light : DEFAULT_SURFACES.light,
    dark: isDarkSurface(stored.dark) ? stored.dark : DEFAULT_SURFACES.dark,
    contrast: isContrastChoice(stored.contrast)
      ? stored.contrast
      : DEFAULT_SURFACES.contrast,
  };
}

/**
 * The attributes `<html>` carries, with the defaults left off.
 *
 * `globals.css` reacts to `data-light="paper"`, `data-dark="midnight"` and
 * `data-contrast="more"`. `data-contrast="standard"` changes no token; it is
 * there so the pre-paint script below knows the reader chose, and does not
 * apply the system's preference on top.
 */
export function surfaceAttributes(
  preferences: SurfacePreferences,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (preferences.light !== DEFAULT_SURFACES.light) {
    attributes["data-light"] = preferences.light;
  }
  if (preferences.dark !== DEFAULT_SURFACES.dark) {
    attributes["data-dark"] = preferences.dark;
  }
  if (preferences.contrast !== DEFAULT_SURFACES.contrast) {
    attributes["data-contrast"] = preferences.contrast;
  }
  return attributes;
}

/**
 * Runs before anything paints, the way the theme provider's own script does.
 *
 * "Auto" contrast is the absence of an attribute, and the server cannot know
 * what the reader's system asks for — so if nothing was chosen and the
 * system prefers more contrast, the attribute is set here, before the first
 * frame. Inline, so it needs the request nonce to pass the CSP.
 */
export const CONTRAST_PREPAINT_SCRIPT =
  '(function(){try{var d=document.documentElement;if(!d.hasAttribute("data-contrast")&&window.matchMedia("(prefers-contrast: more)").matches){d.setAttribute("data-contrast","more")}}catch(e){}})()';

/**
 * The ground and the card of each surface, for the drawn preview cards and
 * for the browser chrome (`theme-color`).
 *
 * These are the same values the override blocks in `globals.css` carry —
 * `src/modules/profile/surface.test.ts` checks that they still match.
 */
export const SURFACE_SWATCHES: Record<Surface, { ground: Oklch; bar: Oklch }> =
  {
    cream: {
      ground: { l: 0.977, c: 0.007, h: 85 },
      bar: { l: 1, c: 0, h: 0 },
    },
    paper: {
      ground: { l: 0.99, c: 0, h: 0 },
      // White on near-white would not show, so the card is drawn a step
      // down; the real card is white and separates by its ring.
      bar: { l: 0.94, c: 0.004, h: 260 },
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
