/**
 * OKLCH to sRGB, and the contrast maths that goes with it.
 *
 * The interface is authored in OKLCH — `src/app/globals.css` defines every
 * token that way, and browsers evaluate it directly. Two places cannot:
 * email clients, which support neither `oklch()` nor custom properties, and
 * the icon rasteriser, which writes PNGs. Both need a literal hex, and this is
 * how one is derived rather than eyeballed.
 *
 * The conversion is Björn Ottosson's, unchanged: OKLCH → OKLab → LMS → linear
 * sRGB → gamma-encoded sRGB. Out-of-gamut values are clipped per channel,
 * which is the same thing a browser does for a colour it cannot show.
 */

export interface Oklch {
  /** Perceptual lightness, 0–1. */
  readonly l: number;
  /** Chroma. 0 is grey; the sRGB gamut runs out somewhere below 0.4. */
  readonly c: number;
  /** Hue angle in degrees. */
  readonly h: number;
}

/** Matches `oklch(0.712 0.168 30)`, with or without the function wrapper. */
const OKLCH_PATTERN =
  /^\s*(?:oklch\(\s*)?(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)?\s*$/;

export function parseOklch(value: string): Oklch | null {
  const match = OKLCH_PATTERN.exec(value);
  if (!match) return null;
  const [l, c, h] = match.slice(1, 4).map(Number);
  return Number.isFinite(l) && Number.isFinite(c) && Number.isFinite(h)
    ? { l, c, h }
    : null;
}

/** Linear-light sRGB, each channel clipped into gamut. */
function toLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);

  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ].map((channel) => Math.min(1, Math.max(0, channel))) as [
    number,
    number,
    number,
  ];
}

function encodeGamma(channel: number): number {
  return channel > 0.0031308
    ? 1.055 * channel ** (1 / 2.4) - 0.055
    : 12.92 * channel;
}

function decodeGamma(channel: number): number {
  return channel > 0.04045
    ? ((channel + 0.055) / 1.055) ** 2.4
    : channel / 12.92;
}

/** Uppercase `#RRGGBB`, the form email clients and `sharp` both want. */
export function oklchToHex(color: Oklch): string {
  const channels = toLinearRgb(color).map((channel) =>
    Math.round(Math.min(1, Math.max(0, encodeGamma(channel))) * 255),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) =>
    parseInt(value.slice(offset, offset + 2), 16),
  ) as [number, number, number];
}

/** WCAG 2.2 relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => decodeGamma(channel / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio, 1–21. Order of the arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (first, second) => second - first,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

/** Composites `hex` at `alpha` over an opaque `backdrop`. */
export function blend(hex: string, alpha: number, backdrop: string): string {
  const source = hexToRgb(hex);
  const target = hexToRgb(backdrop);
  const mixed = source.map((channel, index) =>
    Math.round(channel * alpha + target[index] * (1 - alpha)),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * The same colour, darkened until it is readable on `backdrop`.
 *
 * Lightness comes down in small steps and hue and chroma are left alone, so
 * what comes back is recognisably the token it started from rather than a
 * second colour that happens to pass. Used for text roles whose token was
 * chosen as a fill — coral at `--primary` is a button, and the same coral as
 * 14px body copy on white is 2.8:1.
 */
export function darkenUntilReadable(
  color: Oklch,
  backdrop: string,
  minimumRatio: number,
): Oklch {
  const STEP = 0.005;
  let candidate = color;
  while (
    candidate.l > 0 &&
    contrastRatio(oklchToHex(candidate), backdrop) < minimumRatio
  ) {
    candidate = { ...candidate, l: Number((candidate.l - STEP).toFixed(3)) };
  }
  return candidate;
}
